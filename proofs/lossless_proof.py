import json, csv, io, random, string
import tiktoken

enc = tiktoken.get_encoding("o200k_base")  # the GPT-4o tokenizer encoding
def toks(s): return len(enc.encode(s))

# ============================================================
# THE PROTOCOL: a LOSSLESS re-encode of tabular records.
# compress() -> decompress() must return the EXACT original.
# We are deleting encoding redundancy (repeated keys, braces,
# quotes, whitespace), NOT information.
# ============================================================
TYPE_OF = {str:"s", int:"i", float:"f", bool:"b"}
def typ(v):
    if isinstance(v, bool): return "b"      # bool before int (bool is subclass of int)
    return TYPE_OF[type(v)]

def compress(records):
    keys = list(records[0].keys())
    header = ",".join(f"{k}:{typ(records[0][k])}" for k in keys)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in records:
        row = []
        for k in keys:
            v = r[k]
            if isinstance(v, bool): row.append("1" if v else "0")
            elif isinstance(v, float): row.append(repr(v))   # exact float round-trip
            else: row.append(str(v))
        w.writerow(row)
    return header + "\n" + buf.getvalue().rstrip("\n")

def decompress(blob):
    head, body = blob.split("\n", 1)
    cols = [c.rsplit(":",1) for c in head.split(",")]
    cast = {"s":str, "i":int, "f":float, "b":lambda x: x=="1"}
    out = []
    for row in csv.reader(io.StringIO(body)):
        rec = {}
        for (name,t), cell in zip(cols, row):
            rec[name] = cast[t](cell)
        out.append(rec)
    return out

# ---- realistic business dataset ----
def make(n):
    F = [("employee_full_name",["Jordan Avery","Sam Rivera","Casey Nguyen","Riley Brooks","Drew Patel"]),
         ("department_name",["Customer Support","Engineering","Sales Operations","Marketing","Finance"]),
         ("monthly_performance_score",[87,92,78,95,81]),
         ("tickets_resolved_last_month",[142,38,210,55,17]),
         ("customer_satisfaction_rating",[4.6,4.9,4.1,4.8,4.3]),
         ("years_at_company",[3,7,2,5,9]),
         ("is_remote_employee",[True,False,True,True,False]),
         ("current_region",["APAC","EMEA","NA","APAC","EMEA"])]
    return [{k:v[i%len(v)] for k,v in F} for i in range(n)]

print("="*60)
print("PROOF 1: round-trip is EXACT on the real dataset")
print("="*60)
for n in (60, 600):
    data = make(n)
    blob = compress(data)
    back = decompress(blob)
    exact = back == data and json.dumps(back) == json.dumps(data)
    pretty = json.dumps(data, indent=2)        # what people paste
    minified = json.dumps(data, separators=(",",":"))  # the 'smart' baseline
    print(f"\n--- {n} records ---  lossless round-trip: {exact}")
    print(f"pretty JSON (pasted) : {toks(pretty):>6} tok")
    print(f"minified JSON (smart): {toks(minified):>6} tok")
    print(f"protocol (lossless)  : {toks(blob):>6} tok")
    print(f"  vs pretty   : -{toks(pretty)-toks(blob):>5} tok ({100*(toks(pretty)-toks(blob))/toks(pretty):.0f}% less)")
    print(f"  vs minified : -{toks(minified)-toks(blob):>5} tok ({100*(toks(minified)-toks(blob))/toks(minified):.0f}% less)  <- kills the 'just minify it' rebuttal")

print("\n"+"="*60)
print("PROOF 2: adversarial fuzz - losslessness under nasty data")
print("="*60)
random.seed(7)
def nasty():
    pool = string.printable + "café—💥\t\"',\n{}[]:"
    return "".join(random.choice(pool) for _ in range(random.randint(0,40)))
fails = 0
for trial in range(5000):
    rec = [{
        "a": nasty(),
        "b": random.randint(-10**9, 10**9),
        "c": random.uniform(-1e6, 1e6),
        "d": bool(random.getrandbits(1)),
        "e": nasty(),
    } for _ in range(random.randint(1,4))]
    if decompress(compress(rec)) != rec:
        fails += 1
print(f"trials: 5000   mismatches: {fails}")
print("commas, quotes, newlines, unicode, emoji, negatives, floats all survive." if fails==0
      else "LOSSLESS CLAIM FAILED")
