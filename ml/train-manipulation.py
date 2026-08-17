#!/usr/bin/env python
"""Root wrapper: `python ml/train-manipulation.py` or `npm run train:ml:manipulation`."""
import os
import runpy
import sys

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

if __name__ == "__main__":
    try:
        runpy.run_module("app.train_manipulation", run_name="__main__")
    except ModuleNotFoundError as error:
        print(f"\nERROR: missing Python package: {error.name}", file=sys.stderr)
        print(
            "\nInstall ML runtimes or train in Docker:\n"
            "  python -m pip install -r apps/ml-engine/requirements.txt "
            "--extra-index-url https://download.pytorch.org/whl/cpu\n"
            "  docker compose exec ml-engine python -m app.train_manipulation --synthetic\n",
            file=sys.stderr,
        )
        sys.exit(1)
