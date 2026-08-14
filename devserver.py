"""Local dev server that disables all HTTP caching.

Plain `python -m http.server` lets Chrome heuristically cache .js/.css files,
which repeatedly caused edits to silently not show up during development.
This wrapper just adds Cache-Control: no-store to every response so the
browser always re-fetches the latest file from disk.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    # http.server.test() binds every interface (0.0.0.0) by default -- fine
    # on a genuinely isolated machine, but this is meant for local
    # development only and was never supposed to be reachable from the
    # network or the internet if run on a shared/cloud box by mistake.
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
