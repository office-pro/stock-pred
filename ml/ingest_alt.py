#!/usr/bin/env python
"""Root wrapper for alternative-data ingest (macro + news + social)."""
import os
import runpy
import sys

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

if __name__ == "__main__":
    try:
        runpy.run_module("app.ingest_alt", run_name="__main__")
    except ModuleNotFoundError as error:
        print(f"\nERROR: missing Python package: {error.name}", file=sys.stderr)
        sys.exit(1)
