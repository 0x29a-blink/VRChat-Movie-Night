import math


def safe_float(value, default: float = 0.0) -> float:
    """JSON-safe float (rejects nan/inf)."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return n if math.isfinite(n) else default
