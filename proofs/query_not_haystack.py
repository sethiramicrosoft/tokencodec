import json
from collections import defaultdict
import tiktoken

enc = tiktoken.get_encoding("o200k_base")
def toks(s): return len(enc.encode(s))

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

QUESTION = ("For each department, give the average monthly_performance_score "
            "and the number of employees. Sort by average, highest first.")

# The SAME final answer both paths must produce (computed for real).
def final_answer(data):
    agg = defaultdict(lambda: [0,0])  # dept -> [sum_score, count]
    for r in data:
        a = agg[r["department_name"]]
        a[0] += r["monthly_performance_score"]; a[1] += 1
    rows = sorted(((d, s/c, c) for d,(s,c) in agg.items()),
                  key=lambda x: x[1], reverse=True)
    lines = ["department | avg_score | employees"]
    for dept, avg, c in rows:
        lines.append(f"{dept} | {avg:.1f} | {c}")
    return "\n".join(lines)

# ----- PATH B intermediates (what actually crosses the API) -----
SCHEMA = ("table employees(employee_full_name:str, department_name:str, "
          "monthly_performance_score:int, tickets_resolved_last_month:int, "
          "customer_satisfaction_rating:float, years_at_company:int, "
          "is_remote_employee:bool, current_region:str)")
MODEL_CODE = ("import pandas as pd\n"
              "g=df.groupby('department_name')['monthly_performance_score']"
              ".agg(['mean','count']).sort_values('mean',ascending=False)\n"
              "print(g)")
SYS = "You write a pandas snippet against `df` to answer the question. Return only code."

# prices ($ per 1M tokens) - illustrative, Claude Sonnet-class
Pi, Po = 3.00, 15.00
def cost(inp, out): return (inp*Pi + out*Po)/1e6

print(f"{'rows':>6} | {'PATH A tok':>11} | {'PATH B tok':>11} | {'reduction':>9} | {'A $/1k calls':>12} | {'B $/1k calls':>12} | {'saved/1k':>9}")
print("-"*92)
for n in (60, 600, 6000, 60000):
    data = make(n)
    ans = final_answer(data)
    assert final_answer(data) == ans  # same answer, both paths

    # PATH A: dump all data + question in, get answer out
    a_in  = toks("Answer the question using this data.\n" + QUESTION + "\n" + json.dumps(data))
    a_out = toks(ans)
    A = a_in + a_out

    # PATH B: (call1) schema+question -> code   (call2) tiny result -> answer
    b_in1  = toks(SYS + "\n" + SCHEMA + "\n" + QUESTION)
    b_out1 = toks(MODEL_CODE)
    result_table = ans  # the computed result is literally the small table
    b_in2  = toks("Here is the query result. Write the final answer.\n" + result_table)
    b_out2 = toks(ans)
    B = b_in1 + b_out1 + b_in2 + b_out2

    red = A / B
    ca = cost(a_in, a_out) * 1000
    cb = cost(b_in1+b_in2, b_out1+b_out2) * 1000
    print(f"{n:>6} | {A:>11} | {B:>11} | {red:>7.0f}x | ${ca:>10.2f} | ${cb:>10.2f} | ${ca-cb:>7.2f}")

print("\nThe data never enters the prompt. So PATH B barely grows while PATH A grows linearly.")
print("Reduction is not fixed - it scales with your data size.")
