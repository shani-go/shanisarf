#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# The CAMeL Tools side of the performance comparison (`npm run bench`, driven
# by scripts/bench.mjs). It runs CAMeL Tools 1.6.0 over the Database_Pin in
# one of two modes:
#
#   inproc <db> <wordlist>...   load the database, analyze every word in
#                               process, print one JSON object of timings
#   serve <db> <port>           a minimal local analysis service:
#                               POST /analyze {"words": [...]} returns one
#                               list of analyses per word, as JSON
#
# The service is one Python process (stdlib ThreadingHTTPServer; the GIL
# serializes analysis, so it behaves like a single uvicorn worker). Two
# details keep it from measuring the stdlib instead of the analyzer: each
# response goes out in a single write with TCP_NODELAY set (headers and body
# in separate writes hit Nagle plus delayed ACK, ~40-100 ms per request), and
# it is threaded so a client that opens a second keep-alive connection is not
# parked behind the first one's idle timeout. CORS is open so a browser page
# on another localhost port can call it.
#
# Word lists are read with the same rule as scripts/bench.mjs: split on "\n",
# drop a trailing "\r", skip empty lines and "#" metadata lines, keep
# everything else verbatim (the edge-cases list has whitespace-only words).
#
# This is new design, not a port: project header only.

import json
import resource
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from camel_tools.morphology.analyzer import Analyzer
from camel_tools.morphology.database import MorphologyDB

BACKOFFS = ("NONE", "NOAN_PROP")
WARMUP = 200
RUNS = 3


def read_words(paths):
    words = []
    for path in paths:
        with open(path, encoding="utf-8", newline="") as f:
            for line in f.read().split("\n"):
                line = line[:-1] if line.endswith("\r") else line
                if line and not line.startswith("#"):
                    words.append(line)
    return words


def inproc(db_path, wordlists):
    words = read_words(wordlists)
    t0 = time.perf_counter()
    db = MorphologyDB(db_path, "a")
    load_s = time.perf_counter() - t0
    # ru_maxrss is bytes on macOS and KiB on Linux.
    scale = 1 if sys.platform == "darwin" else 1024
    out = {
        "python": sys.version.split()[0],
        "load_s": load_s,
        "rss_mib_after_load": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        * scale
        / 2**20,
        "words": len(words),
    }
    for backoff in BACKOFFS:
        analyzer = Analyzer(db, backoff=backoff, cache_size=0)
        for w in words[:WARMUP]:
            analyzer.analyze(w)
        best = float("inf")
        for _ in range(RUNS):
            t0 = time.perf_counter()
            n = sum(len(analyzer.analyze(w)) for w in words)
            best = min(best, time.perf_counter() - t0)
        out[backoff] = {"total_s": best, "us_per_word": best / len(words) * 1e6,
                        "analyses": n}
    print(json.dumps(out))


def serve(db_path, port):
    analyzer = Analyzer(MorphologyDB(db_path, "a"), backoff="NONE", cache_size=0)

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup()
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        def log_message(self, *args):
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            out = json.dumps([analyzer.analyze(w) for w in body["words"]],
                             ensure_ascii=False).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            # Headers and body in one write (see the header comment).
            self._headers_buffer.append(b"\r\n")
            self._headers_buffer.append(out)
            self.flush_headers()

    server = Server(("127.0.0.1", port), Handler)
    print(json.dumps({"ready": True, "port": server.server_address[1]}), flush=True)
    server.serve_forever()


def main(argv):
    if len(argv) >= 3 and argv[0] == "inproc":
        inproc(argv[1], argv[2:])
    elif len(argv) == 3 and argv[0] == "serve":
        serve(argv[1], int(argv[2]))
    else:
        print("usage: bench_reference.py inproc <db> <wordlist>... | "
              "serve <db> <port>", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
