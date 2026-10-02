#!/usr/bin/env python3
"""Check common OHLCV CSV files without network access.

Usage: python3 tools/validate_ohlcv.py market.csv
Accepts timestamp/open/high/low/close/volume headers, or Binance's standard
headerless kline CSV columns (open_time, open, high, low, close, volume, ...).
"""
import csv
import math
import sys
from datetime import datetime, timezone
from itertools import chain
from pathlib import Path

ALIASES = {
    "time": {"timestamp", "time", "date", "datetime", "opentime", "open_time", "t", "unix"},
    "open": {"open", "o"}, "high": {"high", "h"}, "low": {"low", "l"},
    "close": {"close", "c"}, "volume": {"volume", "vol", "v", "basevolume", "tickvolume"},
}


def norm(value):
    return value.strip().lower().replace(" ", "").replace("-", "_")


def timestamp_value(value):
    raw = value.strip()
    if not raw:
        return None
    try:
        number = float(raw)
    except ValueError:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError:
            return None
    if not math.isfinite(number):
        return None
    if abs(number) < 1e11:
        number *= 1000
    return number


def main(path: Path) -> int:
    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 2
    with path.open("r", newline="", encoding="utf-8-sig") as file:
        sample = file.read(8192)
        file.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(file, dialect)
        first = next(reader, None)
        if not first:
            print("ERROR: empty file")
            return 2
        headers = [norm(value) for value in first]
        mapping = {
            field: next((headers.index(alias) for alias in choices if alias in headers), None)
            for field, choices in ALIASES.items()
        }
        has_header = all(mapping[key] is not None for key in ("time", "open", "high", "low", "close", "volume"))
        if not has_header:
            mapping = {"time": 0, "open": 1, "high": 2, "low": 3, "close": 4, "volume": 5}
            rows = chain([first], reader)
        else:
            rows = reader
        valid = invalid = 0
        previous = None
        first_time = last_time = None
        for line_no, row in enumerate(rows, start=2 if has_header else 1):
            if not row or len(row) <= max(mapping.values()):
                invalid += 1
                continue
            try:
                stamp = row[mapping["time"]].strip()
                instant = timestamp_value(stamp)
                o, h, low, close, volume = (float(row[mapping[key]]) for key in ("open", "high", "low", "close", "volume"))
                if instant is None or not all(math.isfinite(number) for number in (o, h, low, close, volume)):
                    raise ValueError("invalid timestamp or non-finite value")
                if volume < 0 or h < max(o, close, low) or low > min(o, close, h):
                    raise ValueError("OHLC bounds or negative volume")
            except (ValueError, IndexError):
                invalid += 1
                if invalid <= 5:
                    print(f"WARN: invalid row near line {line_no}")
                continue
            valid += 1
            first_time = first_time or stamp
            last_time = stamp
            if previous is not None and instant <= previous:
                if invalid < 5:
                    print(f"WARN: timestamps out of order or duplicated near line {line_no}")
                invalid += 1
            previous = instant
    print(f"Valid candles: {valid:,}")
    print(f"Rows needing review: {invalid:,}")
    print(f"File order range: {first_time or '—'} → {last_time or '—'}")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("")))
