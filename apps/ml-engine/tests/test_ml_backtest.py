from app.ml_backtest import max_drawdown_pct, profit_factor, simulate_book


def test_drawdown_and_profit_factor():
    assert max_drawdown_pct([100, 110, 90, 95]) == -18.18
    assert profit_factor([10, -5, 10, -5]) == 2.0


def test_simulate_book_subtracts_costs():
    trades = [
        {
            "entryTime": 1,
            "exitTime": 1 + 5 * 86_400_000,
            "entry": 100.0,
            "exit": 104.0,
            "confidence": 80,
            "grossReturn": 0.04,
        }
    ]
    book = simulate_book(trades, initial=100_000)
    assert book["trades"] == 1
    assert book["costsPaid"] > 0
    assert book["finalCapital"] < 100_000 + 100_000 * 0.01 * 0.04
