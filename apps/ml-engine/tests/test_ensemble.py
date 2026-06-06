import numpy as np
import pytest

from app.models.ensemble import blend_probabilities, decide, expected_move


def test_blend_uses_spec_weights():
    probas = {
        "xgboost": np.array([[1.0, 0.0, 0.0]]),
        "lightgbm": np.array([[0.0, 1.0, 0.0]]),
        "lstm": np.array([[0.0, 0.0, 1.0]]),
        "transformer": np.array([[0.0, 0.0, 1.0]]),
    }
    blended = blend_probabilities(probas)[0]
    assert blended[0] == pytest.approx(0.40)
    assert blended[1] == pytest.approx(0.25)
    assert blended[2] == pytest.approx(0.35)  # 0.20 + 0.15
    assert blended.sum() == pytest.approx(1.0)


def test_blend_renormalizes_when_a_model_is_missing():
    probas = {
        "xgboost": np.array([[0.5, 0.3, 0.2]]),
        "lightgbm": None,
        "lstm": np.array([[0.5, 0.3, 0.2]]),
        "transformer": None,
    }
    blended = blend_probabilities(probas)[0]
    assert blended[0] == pytest.approx(0.5)
    assert blended.sum() == pytest.approx(1.0)


def test_blend_raises_with_no_models():
    with pytest.raises(RuntimeError):
        blend_probabilities({"xgboost": None})


def test_decide_maps_argmax_to_direction():
    decision = decide(np.array([0.2, 0.25, 0.55]))
    assert decision["direction"] == "UP"
    assert decision["confidence"] == pytest.approx(55.0)
    down = decide(np.array([0.7, 0.2, 0.1]))
    assert down["direction"] == "DOWN"


def test_expected_move_signs():
    moves = {"UP": 0.015, "DOWN": 0.012, "SIDEWAYS": 0.002}
    assert expected_move("UP", moves) == pytest.approx(1.5)
    assert expected_move("DOWN", moves) == pytest.approx(-1.2)
    assert expected_move("SIDEWAYS", moves) == 0.0
