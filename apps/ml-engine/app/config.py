"""Environment-driven configuration (secrets only ever come from env vars)."""
import os
from dataclasses import dataclass, field
from typing import List

DISCLAIMER = "This is not investment advice."

HORIZONS = {
    "NEXT_DAY": {"bars": 1, "threshold": 0.01},
    "NEXT_WEEK": {"bars": 5, "threshold": 0.02},
    "NEXT_10D": {"bars": 10, "threshold": 0.03},
    "NEXT_20D": {"bars": 20, "threshold": 0.04},
}

# Direction models that must exist for the engine to boot.
CORE_HORIZONS = ("NEXT_DAY", "NEXT_WEEK")

ENSEMBLE_WEIGHTS = {
    "xgboost": 0.40,
    "lightgbm": 0.25,
    "lstm": 0.20,
    "transformer": 0.15,
}

CLASSES = ["DOWN", "SIDEWAYS", "UP"]

SEQUENCE_LENGTH = 30

FALLBACK_SYMBOLS = [
    # Nifty 50 core (20)
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "ITC", "LT", "SBIN",
    "BHARTIARTL", "HINDUNILVR", "BAJFINANCE", "MARUTI", "AXISBANK", "TITAN",
    "SUNPHARMA", "TATAMOTORS", "WIPRO", "PERSISTENT", "POLYCAB", "CDSL",
    # Extended midcap/smallcap (80+ for total 100+)
    "KSUBL", "M&MFIN", "JSWSTEEL", "POWERGRID", "NTPC", "COALINDIA", "ONGC",
    "IOCL", "BPCL", "HPCL", "ADANIPOWER", "ADANIGREEN", "ULTRACEMCO",
    "HEIDELBERG", "BOSCHLTD", "EICHERMOT", "BAJAJMOTO", "HEROMOTOCO", "MOTHERSON",
    "SRTRANSIS", "ASTRAL", "CUMMINSIND", "VOLTAS", "WHIRLPOOL", "GODREJCP",
    "COLPAL", "DABUR", "MARICO", "BRITANNIA", "NESTLEIND", "CIPLA", "DRREDDY",
    "BIOCON", "NATCOPHARM", "GLENMARK", "CADILAHC", "AUROBINDO", "LUPIINDIA",
    "TATACOMM", "BSOFT", "MINDTREE", "MPHASIS", "TECHM", "HCLTECH",
    "KSOLVES", "SYNGENE", "BASF", "CHEMTRADE", "RIL", "ASTRAL",
    "VEDANTA", "HINDALCO", "TATASTEELMINE", "JINDALSTEEL", "NATIONALMETL",
    "DLFALL", "OBEROINDIA", "VOLTAS", "BHARTIARTL", "VIL",
    "FEDERALBNK", "IDFCFIRSTB", "INDUSIND", "BANKBARODA", "CANBANK",
    "UNIONBANK", "PNBHOUSING", "AUBANK", "SCBLBANK", "UTBANK",
    "HSBAKINDIA", "YESBANK", "DCBBANK", "PNBBANK", "SYNBANK",
    "CENTBANK", "INDIANB", "KARNBANK", "IDBIBANK", "SOUTHBANK",
    "TMBBANK", "BANKFINTECH", "RELIANCE", "NTPC", "COALINDIA",
    "ONGC", "IOCL", "BPCL", "HPCL", "ADANIPOWER", "ADANIGREEN",
    "BAJFINANCE", "MOTILALOSWL", "CHOICEINDIA", "TIRAHANAGAR",
    "ALLCARGO", "RELRETAIL", "VAIBHAVGLOB", "VAIBHAVINTL",
    "ITDEVELOP", "CODEFARM", "KSOLVES", "PERSISTENT", "BSOFT",
]


@dataclass
class Settings:
    port: int = int(os.getenv("ML_ENGINE_PORT", "8000"))
    models_dir: str = os.getenv("ML_MODELS_DIR", "./ml-models")
    market_data_url: str = os.getenv("MARKET_DATA_SERVICE_URL", "http://localhost:3002")
    kafka_brokers: str = os.getenv("KAFKA_BROKERS", "localhost:9092")
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql://stockpred:stockpred@localhost:5432/stockpred"
    )
    prediction_interval_seconds: int = int(os.getenv("ML_PREDICTION_INTERVAL_SECONDS", "300"))
    # 0 = every listed symbol. Set a positive cap to bound the periodic loop.
    predict_universe_limit: int = int(os.getenv("ML_PREDICT_UNIVERSE_LIMIT", "0"))
    model_version: str = os.getenv("ML_MODEL_VERSION", "ensemble-v1")
    symbols: List[str] = field(default_factory=list)

    @property
    def asyncpg_dsn(self) -> str:
        # asyncpg rejects Prisma's ?schema= suffix.
        return self.database_url.split("?")[0]


settings = Settings()
