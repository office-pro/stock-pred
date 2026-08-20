from app.nlp import classify_event, lexicon_sentiment, score_headline


def test_contract_headline_is_positive_event():
    scored = score_headline("Reliance bags major renewable energy contract")
    assert scored["eventType"] in {"NEW_CONTRACT", "ORDER_WIN", "CAPEX"}
    assert float(scored["sentiment"]) > 0
    assert float(scored["eventStrength"]) >= 0.65


def test_fraud_headline_is_negative():
    event, strength = classify_event("SEBI opens fraud probe at ABC Ltd")
    assert event in {"FRAUD", "REGULATORY_ACTION", "LEGAL_ISSUE"}
    assert strength >= 0.8
    score, _pos, neg, _neu = lexicon_sentiment("fraud probe investigation scam")
    assert score < 0
    assert neg > 0
