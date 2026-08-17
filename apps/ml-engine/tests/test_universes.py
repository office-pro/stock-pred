from app.universes import basket_symbols, filter_listed, normalize_universe


def test_nifty50_intersects_listed_and_aliases():
    listed = ["RELIANCE", "TCS", "HDFCBANK", "FOOCOIN", "TATAMOTORS", "ZOMATO"]
    kept = filter_listed(listed, "nifty50")
    assert "RELIANCE" in kept
    assert "TCS" in kept
    assert "FOOCOIN" not in kept
    assert "TATAMOTORS" in kept  # alias of TMPV
    assert "ZOMATO" in kept  # alias of ETERNAL


def test_smallcap_excludes_nifty100():
    listed = ["RELIANCE", "CDSL", "CAMS", "BSOFT", "ABB"]
    kept = filter_listed(listed, "smallcap")
    assert "RELIANCE" not in kept
    assert "ABB" not in kept  # Next 50 / Nifty 100
    assert "CDSL" in kept
    assert "CAMS" in kept


def test_all_is_passthrough():
    listed = ["RELIANCE", "ZZZ"]
    assert filter_listed(listed, "all") == listed


def test_normalize_accepts_aliases():
    assert normalize_universe("Nifty-50") == "nifty50"
    assert normalize_universe("n100") == "nifty100"
    assert normalize_universe("small") == "smallcap"


def test_nifty50_basket_is_about_fifty_without_full_book():
    names = basket_symbols("nifty50")
    assert 45 <= len(names) <= 55
    assert "RELIANCE" in names
    assert "TCS" in names
