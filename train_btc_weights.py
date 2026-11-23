#!/usr/bin/env python3
"""Train BTCUSDT 15m directional weights from Binance Spot klines.

Downloads approximately two years of candles in 1,000-row batches, builds
strictly causal features, evaluates a chronological 80/20 split, and exports
real LightGBM/CatBoost feature-importance weights.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from catboost import CatBoostClassifier
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "btc-weights.json"
SYMBOL = "BTCUSDT"
INTERVAL = "15m"
DAYS = 730
BATCH = 1000
CONFIDENCE = 0.70
HORIZON = 3
TARGET_RETURN = 0.003
BINANCE_URL = "https://api.binance.com/api/v3/klines"
FEATURES = [
    "rsi_14", "macd", "macd_hist", "dist_ema_20", "dist_ema_50",
    "dist_ema_200", "bb_pos", "atr_pct", "ret_1", "ret_5", "ret_10",
    "ret_20", "vol_ratio", "is_london", "is_ny", "is_asia",
]


def fetch_candles() -> pd.DataFrame:
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = int((datetime.now(timezone.utc) - timedelta(days=DAYS)).timestamp() * 1000)
    rows = []
    cursor = start_ms
    session = requests.Session()
    session.headers.update({"User-Agent": "BTC-RADAR-weight-trainer/1.0"})
    batch_no = 0

    while cursor < end_ms:
        response = session.get(
            BINANCE_URL,
            params={"symbol": SYMBOL, "interval": INTERVAL, "startTime": cursor,
                    "endTime": end_ms, "limit": BATCH},
            timeout=30,
        )
        if response.status_code == 429 or response.status_code == 418:
            wait = int(response.headers.get("Retry-After", "5"))
            print(f"Binance rate limit; waiting {wait}s", flush=True)
            time.sleep(max(wait, 2))
            continue
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        rows.extend(batch)
        batch_no += 1
        last_open = int(batch[-1][0])
        next_cursor = last_open + 15 * 60 * 1000
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        print(f"Downloaded batch {batch_no}: {len(rows)} candles", flush=True)
        if len(batch) < BATCH:
            break
        time.sleep(0.20)

    if not rows:
        raise RuntimeError("Binance returned no candles.")
    cols = ["time", "open", "high", "low", "close", "volume", "close_time",
            "quote_volume", "trades", "taker_base", "taker_quote", "ignore"]
    df = pd.DataFrame(rows, columns=cols)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.drop_duplicates("time").sort_values("time").reset_index(drop=True)
    # Do not train on the still-forming candle.
    now = pd.Timestamp.now(tz="UTC")
    df = df[df["time"] + pd.Timedelta(minutes=15) <= now].reset_index(drop=True)
    return df[["time", "open", "high", "low", "close", "volume"]]


def make_dataset(c: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    close, high, low, volume = c["close"], c["high"], c["low"], c["volume"]
    f = pd.DataFrame(index=c.index)

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    avg_loss = loss.ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    f["rsi_14"] = (100 - 100 / (1 + rs)).fillna(50)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    macd_signal = macd_line.ewm(span=9, adjust=False).mean()
    f["macd"] = macd_line
    f["macd_hist"] = macd_line - macd_signal

    for period in (20, 50, 200):
        ema = close.ewm(span=period, adjust=False).mean()
        f[f"dist_ema_{period}"] = close / ema - 1

    mid = close.rolling(20, min_periods=20).mean()
    std = close.rolling(20, min_periods=20).std(ddof=0)
    upper, lower = mid + 2 * std, mid - 2 * std
    f["bb_pos"] = (close - lower) / (upper - lower).replace(0, np.nan)

    prev_close = close.shift(1)
    tr = pd.concat([(high - low), (high - prev_close).abs(),
                    (low - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    f["atr_pct"] = atr / close

    for n in (1, 5, 10, 20):
        f[f"ret_{n}"] = close.pct_change(n)

    vol_avg = volume.rolling(20, min_periods=20).mean()
    f["vol_ratio"] = volume / vol_avg.replace(0, np.nan)

    hours = c["time"].dt.hour
    f["is_london"] = ((hours >= 7) & (hours < 16)).astype(int)
    f["is_ny"] = ((hours >= 13) & (hours < 22)).astype(int)
    f["is_asia"] = ((hours >= 0) & (hours < 9)).astype(int)

    future_close = close.shift(-HORIZON)
    y = (future_close >= close * (1 + TARGET_RETURN)).astype(float)
    y[future_close.isna()] = np.nan

    data = f[FEATURES].replace([np.inf, -np.inf], np.nan)
    valid = data.notna().all(axis=1) & y.notna()
    return data.loc[valid].astype(float), y.loc[valid].astype(int)


def main() -> None:
    print("Fetching ~2 years of BTCUSDT 15m candles from Binance Spot...", flush=True)
    candles = fetch_candles()
    X, y = make_dataset(candles)
    if len(X) < 5000 or y.nunique() < 2:
        raise RuntimeError(f"Insufficient usable training rows: {len(X)}")

    split = int(len(X) * 0.80)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]
    if y_train.nunique() < 2 or y_test.nunique() < 2:
        raise RuntimeError("Training or test partition contains only one class.")

    print(f"Training LightGBM (400 trees) on {len(X_train):,} rows...", flush=True)
    lgbm = LGBMClassifier(
        n_estimators=400, learning_rate=0.04, num_leaves=31,
        max_depth=-1, subsample=0.85, colsample_bytree=0.85,
        reg_lambda=1.0, random_state=42, n_jobs=-1, verbosity=-1,
    )
    lgbm.fit(X_train, y_train)

    print(f"Training CatBoost (400 iterations) on {len(X_train):,} rows...", flush=True)
    cat = CatBoostClassifier(
        iterations=400, depth=6, learning_rate=0.04, loss_function="Logloss",
        eval_metric="Logloss", random_seed=42, verbose=False,
        allow_writing_files=False, thread_count=-1,
    )
    cat.fit(X_train, y_train)

    p_lgbm = lgbm.predict_proba(X_test)[:, 1]
    p_cat = cat.predict_proba(X_test)[:, 1]
    probabilities = (p_lgbm + p_cat) / 2.0
    selected = (probabilities >= CONFIDENCE) | (probabilities <= 1 - CONFIDENCE)
    predicted = (probabilities[selected] >= 0.5).astype(int)
    actual = y_test.to_numpy()[selected]
    trade_count = int(selected.sum())
    accuracy = float(accuracy_score(actual, predicted)) if trade_count else None

    lgbm_imp = np.asarray(lgbm.feature_importances_, dtype=float)
    cat_imp = np.asarray(cat.feature_importances_, dtype=float)
    lgbm_norm = lgbm_imp / lgbm_imp.sum() if lgbm_imp.sum() else np.zeros_like(lgbm_imp)
    cat_norm = cat_imp / cat_imp.sum() if cat_imp.sum() else np.zeros_like(cat_imp)
    combined = (lgbm_norm + cat_norm) / 2.0
    order = np.argsort(combined)[::-1]
    top_indices = order[:20]
    top_weights = combined[top_indices]
    if top_weights.sum():
        top_weights = top_weights / top_weights.sum()

    weights = {FEATURES[i]: round(float(w), 8)
               for i, w in zip(top_indices, top_weights)}
    train_stats = {}
    for name in weights:
        train_stats[name] = {
            "mean": round(float(X_train[name].mean()), 8),
            "std": round(float(X_train[name].std(ddof=0)), 8),
        }
    rules_top20 = [
        {"feature": FEATURES[i], "weight": round(float(w), 8),
         "lgbm_importance": round(float(lgbm_norm[i]), 8),
         "catboost_importance": round(float(cat_norm[i]), 8)}
        for i, w in zip(top_indices, top_weights)
    ]

    payload = {
        "model": "LightGBM(400) + CatBoost(400), chronological walk-forward 80/20",
        "symbol": SYMBOL,
        "timeframe": INTERVAL,
        "weights": weights,
        "rules_top20": rules_top20,
        "feature_stats": train_stats,
        "threshold": CONFIDENCE,
        "training_metrics": {
            "candles_downloaded": int(len(candles)),
            "usable_rows": int(len(X)),
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "confidence_threshold": CONFIDENCE,
            "trades_above_threshold": trade_count,
            "accuracy_above_threshold": accuracy,
            "accuracy_percent_above_threshold": round(accuracy * 100, 4) if accuracy is not None else None,
            "label": f"close in {HORIZON} candles >= current close * {1 + TARGET_RETURN}",
            "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        },
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n=== BTC RADAR TRAINING REPORT ===")
    print(f"Downloaded candles: {len(candles):,}")
    print(f"Usable rows: {len(X):,} | train: {len(X_train):,} | test: {len(X_test):,}")
    print(f"Accuracy at confidence >= {CONFIDENCE:.0%}: "
          f"{accuracy * 100:.2f}%" if accuracy is not None else
          f"Accuracy at confidence >= {CONFIDENCE:.0%}: N/A (no selected trades)")
    print(f"Selected trades: {trade_count:,}")
    print("Top 5 features:")
    for item in rules_top20[:5]:
        print(f"  {item['feature']}: {item['weight']:.6f}")
    print(f"Saved real trained weights to: {OUT}")


if __name__ == "__main__":
    main()
