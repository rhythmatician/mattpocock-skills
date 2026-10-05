# Graphify command usage

Load this only for `/graphify --help` or `/graphify -h` with no other arguments. Print the Usage block verbatim and stop.

## Usage

```
/graphify                                             # full pipeline on current directory
/graphify <path>                                      # full pipeline on a local path
/graphify https://github.com/<owner>/<repo>           # clone then build
/graphify https://github.com/<owner>/<repo> --branch <branch>  # clone a specific branch
/graphify <url1> <url2> ...                           # build and merge several repositories
/graphify <path> --mode deep                          # richer semantic extraction
/graphify <path> --update                             # re-extract changed files
/graphify <path> --directed                           # preserve edge direction
/graphify <path> --whisper-model medium               # improve transcription accuracy
/graphify <path> --cluster-only                       # rerun clustering only
/graphify <path> --no-viz                             # skip HTML visualization
/graphify <path> --html                               # explicit HTML output (default)
/graphify <path> --svg                                # also export SVG
/graphify <path> --graphml                            # also export GraphML
/graphify <path> --neo4j                              # generate Neo4j Cypher
/graphify <path> --neo4j-push bolt://localhost:7687   # push to Neo4j
/graphify <path> --falkordb                           # generate FalkorDB Cypher
/graphify <path> --falkordb-push falkordb://localhost:6379  # push to FalkorDB
/graphify <path> --mcp                                # start the MCP stdio server
/graphify <path> --watch                              # rebuild after code changes
/graphify <path> --wiki                               # generate the agent-crawlable wiki
/graphify <path> --obsidian --obsidian-dir ~/vaults/my-project  # write a vault
/graphify add <url>                                   # add a URL to the corpus
/graphify add <url> --author "Name"                   # tag the author
/graphify add <url> --contributor "Name"              # tag the contributor
/graphify query "<question>"                          # broad BFS traversal
/graphify query "<question>" --dfs                    # trace a specific path
/graphify query "<question>" --budget 1500            # cap answer tokens
/graphify path "AuthModule" "Database"                # shortest concept path
/graphify explain "SwinTransformer"                   # explain one node
```
