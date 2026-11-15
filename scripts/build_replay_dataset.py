#!/usr/bin/env python3
"""Build a frozen replay snapshot of Yahoo Finance daily data with yfinance.

Offline tool, never part of the web runtime. Run it from the repository root:

    uv venv scripts/.venv --python 3.13
    uv pip install --python scripts/.venv/bin/python yfinance pandas
    scripts/.venv/bin/python scripts/build_replay_dataset.py

What it does
- Symbols: every tradable entry of data/universe.json (bond-yield rows are not prices and are skipped), the
  extras and benchmarks listed in data/replay/symbol-map.json, and USDCAD=X. App symbols are mapped to Yahoo
  symbols through data/replay/symbol-map.json only.
- Download: yfinance history(auto_adjust=False, actions=True) from 2020-12-01 to the day before extraction
  (yfinance's end bound is exclusive, so end = extraction date). One symbol at a time, a pause between symbols,
  a longer pause between batches, retries with exponential backoff on rate limits and network errors.
- Resumable: every downloaded symbol is cached in scripts/.cache/replay/<snapshot-id>/ and never fetched again
  for the same snapshot id. Re-running after an interruption picks up where it stopped.
- Output: data/replay/<snapshot-id>/ with prices.csv, actions.csv, fx.csv and manifest.json. The folder is never
  overwritten: the script refuses to run if it already exists.
- Quality checks are recorded, never silently corrected. A hard failure excludes the symbol with its reason;
  a soft warning keeps the symbol and lists the warning in the manifest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import random
import shutil
import sys
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

try:  # surface Yahoo errors (rate limits) as exceptions instead of an empty frame
    yf.config.debug.hide_exceptions = False
except AttributeError:
    pass

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE = ROOT / "data" / "universe.json"
SYMBOL_MAP = ROOT / "data" / "replay" / "symbol-map.json"
OUT_ROOT = ROOT / "data" / "replay"
CACHE_ROOT = ROOT / "scripts" / ".cache" / "replay"

WINDOW_START = "2020-12-01"
SUPPORTED_CURRENCIES = {"CAD", "USD"}

# Politeness
PAUSE_BETWEEN_SYMBOLS = 1.2   # seconds (plus jitter)
BATCH_SIZE = 25
PAUSE_BETWEEN_BATCHES = 15.0  # seconds
MAX_ATTEMPTS = 6
BACKOFF_BASE = 20.0           # seconds, doubled each attempt

# Quality thresholds
JUMP_THRESHOLD = 0.25         # day-to-day move in adj_close
MISSING_HARD_SHARE = 0.02     # missing > 2 % of the expected days (and more than 3 days) excludes the symbol
LATE_START_DAYS = 7           # first row more than 7 calendar days after the group's first day: soft warning
EARLY_END_DAYS = 7            # last row more than 7 calendar days before the group's last day: hard (stale/delisted)
REFERENCE_SHARE = 0.5         # a day belongs to an exchange's calendar when >= 50 % of its live symbols trade


def fmt(x: float) -> str:
    """At most 6 decimals, no trailing zeros; empty for NaN."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ""
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_symbols() -> tuple[list[dict], list[dict], str]:
    """Returns (series to download, not replayable entries, fx symbol). Each series: yahoo symbol + app symbols."""
    universe = json.loads(UNIVERSE.read_text())
    smap = json.loads(SYMBOL_MAP.read_text())
    mapping: dict[str, str] = smap["map"]
    not_replayable = {e["symbol"]: e["reason"] for e in smap["notReplayable"]}

    series: dict[str, dict] = {}

    def add(app_symbol: str, origin: str) -> None:
        yahoo = mapping.get(app_symbol, app_symbol)
        entry = series.setdefault(yahoo, {"yahoo": yahoo, "appSymbols": [], "origins": []})
        if app_symbol not in entry["appSymbols"]:
            entry["appSymbols"].append(app_symbol)
        if origin not in entry["origins"]:
            entry["origins"].append(origin)

    skipped = []
    for e in universe["entries"]:
        sym = e["symbol"]
        if sym in not_replayable or e.get("assetClass") == "bond_yield":
            skipped.append({"symbol": sym, "reason": not_replayable.get(sym, "not replayable: a yield is not a price")})
            continue
        add(sym, "universe")
    for e in smap["extras"]:
        add(e["symbol"], "extra")
    return list(series.values()), skipped, smap["fx"]["symbol"]


class RateLimited(Exception):
    pass


def fetch(yahoo: str, start: str, end: str) -> tuple[pd.DataFrame, dict]:
    t = yf.Ticker(yahoo)
    df = t.history(start=start, end=end, auto_adjust=False, actions=True)
    meta = {}
    try:
        hm = t.history_metadata or {}
        meta = {
            "currency": hm.get("currency"),
            "exchangeName": hm.get("exchangeName"),
            "fullExchangeName": hm.get("fullExchangeName"),
            "exchangeTimezoneName": hm.get("exchangeTimezoneName"),
            "instrumentType": hm.get("instrumentType"),
            "longName": hm.get("longName"),
        }
    except Exception as exc:  # metadata is best effort; missing currency is caught by the quality checks
        meta = {"metadataError": str(exc)}
    return df, meta


def is_rate_limit(exc: Exception) -> bool:
    name = type(exc).__name__
    text = str(exc).lower()
    return "ratelimit" in name.lower() or "too many requests" in text or "rate limit" in text or "429" in text


def download_one(yahoo: str, start: str, end: str, cache_dir: Path, log) -> dict:
    """Downloads one symbol into the cache, with retries. Returns the cache status."""
    csv_path = cache_dir / f"{yahoo}.csv"
    meta_path = cache_dir / f"{yahoo}.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())

    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            df, meta = fetch(yahoo, start, end)
            if df is None or df.empty:
                last_error = "Yahoo returned no rows"
                # an empty answer is often final (unknown or delisted symbol): retry once only
                if attempt >= 2:
                    break
            else:
                df.to_csv(csv_path)
                status = {"yahoo": yahoo, "ok": True, "rows": int(len(df)), "meta": meta,
                          "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                          "attempts": attempt}
                meta_path.write_text(json.dumps(status, indent=1))
                return status
        except Exception as exc:  # noqa: BLE001 - yfinance raises many types
            last_error = f"{type(exc).__name__}: {exc}"
            if not is_rate_limit(exc) and attempt >= 2:
                break
        wait = BACKOFF_BASE * (2 ** (attempt - 1)) + random.uniform(0, 3)
        log(f"  {yahoo}: attempt {attempt} failed ({last_error}); waiting {wait:.0f}s")
        time.sleep(wait)

    status = {"yahoo": yahoo, "ok": False, "error": last_error or "unknown error",
              "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    # failures are not cached as final: a later run retries them
    return status


def read_cached(cache_dir: Path, yahoo: str) -> pd.DataFrame:
    df = pd.read_csv(cache_dir / f"{yahoo}.csv")
    # the index was written with its exchange-local offset ('2020-12-01 00:00:00-05:00'): keep the local calendar day
    df["date"] = df["Date"].astype(str).str.slice(0, 10)
    return df


def group_of(meta: dict, yahoo: str) -> str:
    itype = (meta.get("instrumentType") or "").upper()
    if itype == "CRYPTOCURRENCY" or yahoo.endswith("-USD"):
        return "crypto"
    if itype == "CURRENCY" or yahoo.endswith("=X"):
        return "fx"
    tz = meta.get("exchangeTimezoneName") or ""
    if yahoo.endswith(".TO") or tz == "America/Toronto":
        return "TSX"
    return "US"


def reference_calendars(frames: dict[str, pd.DataFrame], groups: dict[str, str]) -> dict[str, list[str]]:
    """Each exchange's calendar as seen in the data: a day counts when most of the symbols live that day trade."""
    out: dict[str, list[str]] = {}
    for g in ("TSX", "US"):
        members = [s for s, gg in groups.items() if gg == g]
        if not members:
            continue
        spans = {s: (frames[s]["date"].min(), frames[s]["date"].max()) for s in members}
        present: dict[str, int] = {}
        for s in members:
            for d in frames[s]["date"]:
                present[d] = present.get(d, 0) + 1
        days = []
        for d, n in present.items():
            live = sum(1 for (a, b) in spans.values() if a <= d <= b)
            if live and n / live >= REFERENCE_SHARE:
                days.append(d)
        out[g] = sorted(days)
    return out


def expected_days(group: str, refs: dict[str, list[str]], start: str, last: str) -> list[str]:
    if group in refs:
        return refs[group]
    rng = pd.date_range(start, last, freq="D" if group == "crypto" else "B")
    return [d.strftime("%Y-%m-%d") for d in rng]


def quality(yahoo: str, df: pd.DataFrame, meta: dict, group: str, refs: dict[str, list[str]],
            window_start: str, window_last: str) -> tuple[list[str], str | None, pd.DataFrame]:
    """Returns (soft warnings, hard reason or None, rows kept). Nothing is corrected: rows with no price are
    dropped and counted, every other row is kept as Yahoo gave it."""
    warnings: list[str] = []
    currency = meta.get("currency")
    if not currency:
        return warnings, "currency unknown (Yahoo metadata gives none)", df
    if group != "fx" and currency not in SUPPORTED_CURRENCIES:
        return warnings, f"currency {currency} is not CAD or USD", df

    na = df["Close"].isna() | df["Adj Close"].isna()
    if na.any():
        warnings.append(f"{int(na.sum())} rows with no close price were dropped")
    df = df[~na].copy()
    if df.empty:
        return warnings, "no usable price rows", df
    df = df.drop_duplicates(subset="date", keep="last").sort_values("date")
    nonpos = (df["Close"] <= 0) | (df["Adj Close"] <= 0)
    if nonpos.any():
        return warnings, f"{int(nonpos.sum())} rows with a zero or negative price", df

    first, last = df["date"].iloc[0], df["date"].iloc[-1]
    exp_all = expected_days(group, refs, window_start, window_last)
    if exp_all:
        g_first, g_last = exp_all[0], exp_all[-1]
        if dt.date.fromisoformat(first) > dt.date.fromisoformat(g_first) + dt.timedelta(days=LATE_START_DAYS):
            warnings.append(f"incomplete history: starts late ({first}; window starts {g_first})")
        if dt.date.fromisoformat(last) < dt.date.fromisoformat(g_last) - dt.timedelta(days=EARLY_END_DAYS):
            return warnings, f"incomplete history: ends early ({last}; window ends {g_last}), possibly delisted or stale", df

        have = set(df["date"])
        expected = [d for d in exp_all if first <= d <= last]
        missing = [d for d in expected if d not in have]
        if missing:
            share = len(missing) / max(1, len(expected))
            sample = ", ".join(missing[:5]) + (" ..." if len(missing) > 5 else "")
            msg = f"{len(missing)} missing trading days against the {group} calendar ({share:.1%}): {sample}"
            if share > MISSING_HARD_SHARE and len(missing) > 3:
                return warnings, msg, df
            warnings.append(msg)

    ac = df["Adj Close"].astype(float).values
    jumps = []
    for i in range(1, len(ac)):
        r = ac[i] / ac[i - 1] - 1
        if abs(r) > JUMP_THRESHOLD:
            jumps.append(f"{df['date'].iloc[i]} ({r:+.1%})")
    if jumps:
        warnings.append(f"{len(jumps)} day-to-day moves over 25% in adj_close: " + ", ".join(jumps[:5])
                        + (" ..." if len(jumps) > 5 else ""))

    if group != "fx":
        zero = df["Volume"].fillna(0) <= 0
        if zero.any():
            dates = df.loc[zero, "date"].tolist()
            warnings.append(f"{len(dates)} zero-volume days: " + ", ".join(dates[:5]) + (" ..." if len(dates) > 5 else ""))
    return warnings, None, df


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot-id", help="default: yf-<extraction date>")
    ap.add_argument("--only", nargs="*", help="Yahoo symbols to keep (debugging; the snapshot is then partial)")
    ap.add_argument("--extraction-date", help="YYYY-MM-DD, default today (local); the window ends the day before")
    args = ap.parse_args()

    extraction_date = dt.date.fromisoformat(args.extraction_date) if args.extraction_date else dt.date.today()
    snapshot_id = args.snapshot_id or f"yf-{extraction_date.isoformat()}"
    out_dir = OUT_ROOT / snapshot_id
    if out_dir.exists():
        print(f"refusing: {out_dir} already exists (a snapshot is never overwritten)", file=sys.stderr)
        return 2
    cache_dir = CACHE_ROOT / snapshot_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    window_end_exclusive = extraction_date.isoformat()
    window_last = (extraction_date - dt.timedelta(days=1)).isoformat()

    log_path = cache_dir / "build.log"

    def log(msg: str) -> None:
        line = f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}"
        print(line, flush=True)
        with log_path.open("a") as f:
            f.write(line + "\n")

    series, not_replayable, fx_symbol = load_symbols()
    if args.only:
        series = [s for s in series if s["yahoo"] in set(args.only)]
    todo = [s["yahoo"] for s in series] + [fx_symbol]
    log(f"snapshot {snapshot_id}: {len(todo)} Yahoo symbols, window {WINDOW_START} .. {window_last}")

    statuses: dict[str, dict] = {}
    fetched_now = 0
    for i, yahoo in enumerate(todo):
        cached = (cache_dir / f"{yahoo}.json").exists()
        st = download_one(yahoo, WINDOW_START, window_end_exclusive, cache_dir, log)
        statuses[yahoo] = st
        log(f"[{i + 1}/{len(todo)}] {yahoo}: " + ("cached" if cached else ("ok " + str(st.get("rows")) if st["ok"] else "FAILED " + st["error"])))
        if not cached:
            fetched_now += 1
            time.sleep(PAUSE_BETWEEN_SYMBOLS + random.uniform(0, 0.8))
            if fetched_now % BATCH_SIZE == 0:
                log(f"batch pause {PAUSE_BETWEEN_BATCHES:.0f}s")
                time.sleep(PAUSE_BETWEEN_BATCHES)

    # ---------- assemble ----------
    excluded: list[dict] = []
    frames: dict[str, pd.DataFrame] = {}
    groups: dict[str, str] = {}
    for s in series:
        st = statuses[s["yahoo"]]
        if not st["ok"]:
            excluded.append({"yahooSymbol": s["yahoo"], "appSymbols": s["appSymbols"],
                             "reason": f"download failed after retries: {st['error']}"})
            continue
        df = read_cached(cache_dir, s["yahoo"])
        df = df[(df["date"] >= WINDOW_START) & (df["date"] <= window_last)]
        frames[s["yahoo"]] = df
        groups[s["yahoo"]] = group_of(st["meta"], s["yahoo"])

    refs = reference_calendars({k: v.dropna(subset=["Close"]) for k, v in frames.items()}, groups)

    tmp_dir = OUT_ROOT / f".{snapshot_id}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    symbols_manifest: list[dict] = []
    price_lines = ["date,symbol,open,high,low,close,adj_close,volume,currency"]
    action_lines: list[tuple[str, str, str, str]] = []
    for s in series:
        y = s["yahoo"]
        if y not in frames:
            continue
        meta = statuses[y]["meta"]
        warns, hard, df = quality(y, frames[y], meta, groups[y], refs, WINDOW_START, window_last)
        if hard:
            excluded.append({"yahooSymbol": y, "appSymbols": s["appSymbols"], "reason": hard, "warnings": warns})
            continue
        cur = meta["currency"]
        for d, o, h, lo, c, ac, v in zip(df["date"], df["Open"], df["High"], df["Low"], df["Close"],
                                         df["Adj Close"], df["Volume"]):
            vol = "" if pd.isna(v) else str(int(v))
            price_lines.append(f"{d},{y},{fmt(o)},{fmt(h)},{fmt(lo)},{fmt(c)},{fmt(ac)},{vol},{cur}")
        for col, kind in (("Dividends", "dividend"), ("Stock Splits", "split"), ("Capital Gains", "capital_gain")):
            if col in df.columns:
                for d, val in zip(df["date"], df[col]):
                    if not pd.isna(val) and val != 0:
                        action_lines.append((d, y, kind, fmt(float(val))))
        symbols_manifest.append({"yahooSymbol": y, "appSymbols": s["appSymbols"], "origins": s["origins"],
                                 "group": groups[y], "currency": cur,
                                 "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
                                 "exchangeTimezone": meta.get("exchangeTimezoneName"),
                                 "firstDate": df["date"].iloc[0], "lastDate": df["date"].iloc[-1],
                                 "rows": int(len(df)), "warnings": warns})

    # FX: a failure here makes the snapshot unusable (every USD asset needs it)
    fx_status = statuses[fx_symbol]
    if not fx_status["ok"]:
        log(f"FATAL: {fx_symbol} could not be downloaded ({fx_status['error']}); no snapshot written")
        shutil.rmtree(tmp_dir)
        return 1
    fx_df = read_cached(cache_dir, fx_symbol)
    fx_df = fx_df[(fx_df["date"] >= WINDOW_START) & (fx_df["date"] <= window_last)]
    fx_meta = dict(fx_status["meta"])
    fx_meta.setdefault("currency", "CAD")
    fx_warns, fx_hard, fx_df = quality(fx_symbol, fx_df, fx_meta, "fx", refs, WINDOW_START, window_last)
    if fx_hard:
        log(f"FATAL: {fx_symbol} failed a hard check ({fx_hard}); no snapshot written")
        shutil.rmtree(tmp_dir)
        return 1
    fx_lines = ["date,usdcad"] + [f"{d},{fmt(c)}" for d, c in zip(fx_df["date"], fx_df["Close"])]

    # sorted output: prices by (date, symbol), actions by (date, symbol, type) -> deterministic files
    header, body = price_lines[0], price_lines[1:]
    body.sort(key=lambda line: (line[:10], line.split(",", 2)[1]))
    (tmp_dir / "prices.csv").write_text("\n".join([header] + body) + "\n")
    action_lines.sort()
    (tmp_dir / "actions.csv").write_text(
        "\n".join(["date,symbol,type,value"] + [",".join(a) for a in action_lines]) + "\n")
    (tmp_dir / "fx.csv").write_text("\n".join(fx_lines) + "\n")

    files = {}
    for name, rows in (("prices.csv", len(body)), ("actions.csv", len(action_lines)), ("fx.csv", len(fx_lines) - 1)):
        p = tmp_dir / name
        files[name] = {"sha256": sha256(p), "rows": rows, "bytes": p.stat().st_size}

    all_dates = [m["firstDate"] for m in symbols_manifest] + [m["lastDate"] for m in symbols_manifest]
    manifest = {
        "snapshotId": snapshot_id,
        "source": "Yahoo Finance, read with the yfinance Python library (unofficial, not certified)",
        "sourceUrl": "https://finance.yahoo.com",
        "library": {"name": "yfinance", "version": yf.__version__, "pandas": pd.__version__,
                    "python": sys.version.split()[0]},
        "call": "yf.Ticker(symbol).history(start, end, auto_adjust=False, actions=True)",
        "extractedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "extractionDate": extraction_date.isoformat(),
        "window": {"requestedFrom": WINDOW_START, "requestedTo": window_last,
                   "from": min(all_dates) if all_dates else None, "to": max(all_dates) if all_dates else None},
        "columns": {
            "prices.csv": "date (exchange-local trading day), symbol (Yahoo), open/high/low/close (split-adjusted, not "
                          "dividend-adjusted), adj_close (split- and dividend-adjusted: total return), volume, currency",
            "actions.csv": "date (ex-date), symbol (Yahoo), type (dividend | split | capital_gain), value (per share "
                           "in the listing currency; split = new shares per old share)",
            "fx.csv": "date, usdcad = CAD per 1 USD (USDCAD=X daily close)",
        },
        "symbolMap": "data/replay/symbol-map.json",
        "files": files,
        "qualityChecks": {
            "hard (symbol excluded)": [
                "download failed after retries", "currency unknown or not CAD/USD", "no usable price rows",
                "zero or negative price", f"history ends more than {EARLY_END_DAYS} days before the window end",
                f"missing trading days > {MISSING_HARD_SHARE:.0%} of the symbol's own exchange calendar (and more than 3)",
            ],
            "soft (symbol kept, warning listed)": [
                f"history starts more than {LATE_START_DAYS} days after the window start",
                "a few missing trading days", f"day-to-day moves over {JUMP_THRESHOLD:.0%} in adj_close",
                "zero-volume days", "rows with no close price dropped (counted)",
            ],
            "exchangeCalendars": "TSX and U.S. calendars are derived from the snapshot itself: a day belongs to an "
                                 f"exchange when at least {REFERENCE_SHARE:.0%} of its symbols live that day have a row. "
                                 "Crypto is expected every calendar day, USD/CAD every weekday.",
            "neverCorrected": "Values are written as Yahoo returned them (rounded to 6 decimals); nothing is filled in.",
        },
        "calendarDays": {g: {"first": d[0], "last": d[-1], "days": len(d)} for g, d in refs.items() if d},
        "fx": {"yahooSymbol": fx_symbol, "firstDate": fx_df["date"].iloc[0], "lastDate": fx_df["date"].iloc[-1],
               "rows": int(len(fx_df)), "warnings": fx_warns},
        "symbols": sorted(symbols_manifest, key=lambda m: m["yahooSymbol"]),
        "excluded": sorted(excluded, key=lambda m: m["yahooSymbol"]),
        "notReplayable": not_replayable,
        "limitations": [
            "Unofficial source: Yahoo Finance data read with yfinance, not certified; yfinance is meant for personal "
            "and research use, so this snapshot is for demonstration only, not commercial use.",
            "Survivorship bias: the universe is today's list of large companies, replayed into the past.",
            "No fees and no taxes by default.",
            "Currency effect included: USD assets are converted to CAD at the day's USD/CAD rate.",
            "The window starts in December 2020, close to a market top (2021) before the 2022 decline.",
            "Adjusted closes depend on the extraction date: a new extraction can change past adjusted values, which is "
            "why the snapshot is frozen and identified.",
        ],
    }
    (tmp_dir / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    if out_dir.exists():
        log(f"refusing: {out_dir} appeared during the run")
        return 2
    tmp_dir.rename(out_dir)
    log(f"wrote {out_dir}: {len(symbols_manifest)} symbols kept, {len(excluded)} excluded, "
        f"prices.csv {files['prices.csv']['bytes'] / 1e6:.1f} MB")
    for e in excluded:
        log(f"  excluded {e['yahooSymbol']}: {e['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
