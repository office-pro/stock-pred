#!/usr/bin/env python
"""Root wrapper (spec command: `npm run predict`).
Delegates to the ml-engine prediction pipeline in apps/ml-engine.
"""
import os
import runpy
import sys

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

if __name__ == "__main__":
    try:
        runpy.run_module("app.predict", run_name="__main__")
    except ModuleNotFoundError as error:
        print(f"\nERROR: missing Python package: {error.name}", file=sys.stderr)
        print(
            "\nThe ML runtimes are not installed in this Python environment. Either:\n"
            "  1. install them locally:\n"
            "       python -m pip install -r apps/ml-engine/requirements.txt "
            "--extra-index-url https://download.pytorch.org/whl/cpu\n"
            "  2. or predict via the running platform (uses the container's models):\n"
            "       curl http://localhost:3000/api/predictions/RELIANCE\n",
            file=sys.stderr,
        )
        sys.exit(1)
