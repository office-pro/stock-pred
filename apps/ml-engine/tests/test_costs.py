from app.costs import apply_slippage, nse_delivery_fee, round_trip_cost


def test_buy_fill_is_worse_than_mid():
    assert apply_slippage(100.0, "BUY") > 100.0
    assert apply_slippage(100.0, "SELL") < 100.0


def test_round_trip_costs_are_material_on_delivery():
    buy = nse_delivery_fee(100_000, "BUY")
    sell = nse_delivery_fee(100_000, "SELL")
    total = round_trip_cost(100_000, 100_000)
    assert buy > 100  # STT 0.1% plus stamp
    assert sell > 90
    assert total == buy + sell
    assert 0.002 < total / 100_000 < 0.005
