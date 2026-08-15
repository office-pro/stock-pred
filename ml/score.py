#!/usr/bin/env python
"""Root wrapper for walk-forward scoring of trained models."""
import os
import runpy
import sys

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

if __name__ == "__main__":
    runpy.run_module("app.score", run_name="__main__")
