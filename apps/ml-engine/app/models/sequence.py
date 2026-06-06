"""Sequence models (PyTorch): LSTM and a small Transformer encoder.

PyTorch is the single deep-learning runtime here (architecture decision:
one DL framework keeps the image ~2GB smaller than shipping TF + Torch;
the LSTM/Transformer architectures are framework-portable if TF is ever
preferred).
"""
from typing import List

import numpy as np

from ..config import SEQUENCE_LENGTH


def make_sequences(x: np.ndarray, y: np.ndarray, seq_len: int = SEQUENCE_LENGTH):
    """Stack rolling windows of features for sequence models."""
    xs: List[np.ndarray] = []
    ys: List[int] = []
    for i in range(seq_len - 1, len(x)):
        xs.append(x[i - seq_len + 1 : i + 1])
        ys.append(int(y[i]))
    if not xs:
        return np.zeros((0, seq_len, x.shape[1]), dtype="float32"), np.zeros((0,), dtype="int64")
    return np.stack(xs).astype("float32"), np.array(ys, dtype="int64")


def _train_torch(model, x_seq: np.ndarray, y_seq: np.ndarray, epochs: int = 8) -> None:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    dataset = TensorDataset(torch.from_numpy(x_seq), torch.from_numpy(y_seq))
    loader = DataLoader(dataset, batch_size=128, shuffle=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()
    model.train()
    for _epoch in range(epochs):
        for batch_x, batch_y in loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            optimizer.zero_grad()
            loss = criterion(model(batch_x), batch_y)
            loss.backward()
            optimizer.step()
    model.eval()


def _predict_proba_torch(model, x_seq: np.ndarray) -> np.ndarray:
    import torch

    device = next(model.parameters()).device
    with torch.no_grad():
        logits = model(torch.from_numpy(x_seq.astype("float32")).to(device))
        return torch.softmax(logits, dim=1).cpu().numpy()


def _build_lstm(n_features: int):
    from torch import nn

    class LstmNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(n_features, 64, num_layers=2, batch_first=True, dropout=0.1)
            self.head = nn.Linear(64, 3)

        def forward(self, x):
            output, _ = self.lstm(x)
            return self.head(output[:, -1, :])

    return LstmNet()


def _build_transformer(n_features: int):
    import torch
    from torch import nn

    class TransformerNet(nn.Module):
        def __init__(self):
            super().__init__()
            d_model = 64
            self.project = nn.Linear(n_features, d_model)
            self.positional = nn.Parameter(torch.zeros(1, SEQUENCE_LENGTH, d_model))
            layer = nn.TransformerEncoderLayer(
                d_model=d_model, nhead=4, dim_feedforward=128, dropout=0.1, batch_first=True
            )
            self.encoder = nn.TransformerEncoder(layer, num_layers=2)
            self.head = nn.Linear(d_model, 3)

        def forward(self, x):
            h = self.project(x) + self.positional[:, : x.shape[1], :]
            h = self.encoder(h)
            return self.head(h.mean(dim=1))

    return TransformerNet()


class LstmModel:
    name = "lstm"

    def __init__(self, n_features: int):
        self.n_features = n_features
        self.model = None

    def train(self, x: np.ndarray, y: np.ndarray) -> None:
        x_seq, y_seq = make_sequences(x, y)
        self.model = _build_lstm(self.n_features)
        _train_torch(self.model, x_seq, y_seq)

    def predict_proba_last(self, x: np.ndarray) -> np.ndarray:
        """Probability for the latest window of a feature matrix."""
        window = x[-SEQUENCE_LENGTH:][np.newaxis, :, :]
        return _predict_proba_torch(self.model, window)

    def save(self, path: str) -> None:
        import torch

        torch.save(self.model.state_dict(), path)

    def load(self, path: str) -> "LstmModel":
        import torch

        self.model = _build_lstm(self.n_features)
        self.model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
        self.model.eval()
        return self


class TransformerModel:
    name = "transformer"

    def __init__(self, n_features: int):
        self.n_features = n_features
        self.model = None

    def train(self, x: np.ndarray, y: np.ndarray) -> None:
        x_seq, y_seq = make_sequences(x, y)
        self.model = _build_transformer(self.n_features)
        _train_torch(self.model, x_seq, y_seq)

    def predict_proba_last(self, x: np.ndarray) -> np.ndarray:
        window = x[-SEQUENCE_LENGTH:][np.newaxis, :, :]
        return _predict_proba_torch(self.model, window)

    def save(self, path: str) -> None:
        import torch

        torch.save(self.model.state_dict(), path)

    def load(self, path: str) -> "TransformerModel":
        import torch

        self.model = _build_transformer(self.n_features)
        self.model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
        self.model.eval()
        return self
