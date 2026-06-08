import json
import uvicorn
from pathlib import Path

if __name__ == "__main__":
    config = json.loads(Path("config.json").read_text())
    uvicorn.run(
        "app:app",
        host=config.get("host", "0.0.0.0"),
        port=config.get("port", 8000),
        reload=True,
    )
