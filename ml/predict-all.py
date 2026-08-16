#!/usr/bin/env python
"""Score every listed symbol and write ml-models/latest-predictions.json.

Usage:
    npm run predict:ml:all
    python ml/predict-all.py
"""
import os
import runpy
import sys

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

if __name__ == "__main__":
    sys.argv = [sys.argv[0], "--all", *sys.argv[1:]]
    try:
        runpy.run_module("app.batch", run_name="__main__")
    except ModuleNotFoundError as error:
        print(f"\nERROR: missing Python package: {error.name}", file=sys.stderr)
        print(
            "\nInstall ML runtimes or run inside the container:\n"
            "  python -m pip install -r apps/ml-engine/requirements.txt "
            "--extra-index-url https://download.pytorch.org/whl/cpu\n"
            "  npm run predict:ml:docker-all\n",
            file=sys.stderr,
        )
        sys.exit(1)
