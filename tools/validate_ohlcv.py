#!/usr/bin/env python3
"""Check common OHLCV CSV files without network access.

Usage: python3 tools/validate_ohlcv.py market.csv
Accepts timestamp/open/high/low/close/volume headers, or Binance's standard
headerless kline CSV columns (open_time, open, high, low, close, volume, ...).
"""
import csv
import sys
from itertools import chain
from pathlib import Path

ALIASES = {
    "time": {"timestamp", "time", "date", "datetime", "opentime", "open_time", "t", "unix"},
    "open": {"open", "o"}, "high": {"high", "h"}, "low": {"low", "l"},
    "close": {"close", "c"}, "volume": {"volume", "vol", "v", "basevolume", "tickvolume"},
}

def norm(value):
    return value.strip().lower().replace(" ", "").replace("-", "_")

def main(path: Path) -> int:
    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 2
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        sample = f.read(8192)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        reader = csv.reader(f, dialect)
        first = next(reader, None)
        if not first:
            print("ERROR: empty file")
            return 2
        headers = [norm(x) for x in first]
        mapping = {field: next((headers.index(a) for a in choices if a in headers), None)
                   for field, choices in ALIASES.items()}
        has_header = all(mapping[k] is not None for k in ("time", "open", "high", "low", "close", "volume"))
        if not has_header:
            # Standard Binance kline CSV: open time, O, H, L, C, base volume.
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
                o, h, l, c, v = (float(row[mapping[k]]) for k in ("open", "high", "low", "close", "volume"))
                ok = bool(stamp) and min(o, h, l, c, v) >= 0 and h >= max(o, c, l) and l <= min(o, c, h)
                if not ok:
                    raise ValueError("OHLC bounds or negative value")
            except (ValueError, IndexError):
                invalid += 1
                if invalid <= 5:
                    print(f"WARN: invalid row near line {line_no}")
                continue
            valid += 1
            first_time = first_time or stamp
            last_time = stamp
            if previous is not None and stamp < previous:
                if invalid < 5:
                    print(f"WARN: timestamps appear out of order near line {line_no}")
                invalid += 1
            previous = stamp
    print(f"Valid candles: {valid:,}")
    print(f"Rows needing review: {invalid:,}")
    print(f"File order range: {first_time or '—'} → {last_time or '—'}")
    return 0 if valid else 1

if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("")))
