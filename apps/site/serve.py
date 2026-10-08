"""Serve this export locally. Python 3, no third-party dependencies."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    print(f'Site disponible sur http://127.0.0.1:{port} — Ctrl+C pour arrêter.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
