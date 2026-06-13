import tiktoken
enc = tiktoken.get_encoding("o200k_base")

# Stateless chat/agent APIs resend the ENTIRE history every turn.
# So turn k pays for everything said in turns 1..k-1, AGAIN.
# Total billed INPUT tokens over a session grows ~ O(n^2).

S = 1500   # system prompt, resent every turn (tokens)
t = 600    # tokens added per turn (user ~200 + assistant ~400)
price_in = 3.00 / 1e6   # $ per input token (Sonnet-class, illustrative)

def naive_input_tokens(N):
    # turn k input = S + history_before_k = S + (k-1)*t
    return sum(S + (k-1)*t for k in range(1, N+1))

def compressed_input_tokens(N, state=800):
    # keep a constant running summary 'state' instead of full history
    # turn input ~ S + state + this-turn user(200)
    return sum(S + state + 200 for _ in range(1, N+1))

print(f"assumptions: system={S} tok, +{t} tok/turn, price=${price_in*1e6:.2f}/M input\n")
print(f"{'turns':>6} | {'naive billed in':>16} | {'compressed':>12} | {'multiplier':>10} | {'naive $':>9} | {'paid for msg#1':>14}")
print("-"*86)
for N in (10, 40, 100, 200):
    nv = naive_input_tokens(N)
    cp = compressed_input_tokens(N)
    print(f"{N:>6} | {nv:>16,} | {cp:>12,} | {nv/cp:>8.1f}x | ${nv*price_in:>7.2f} | {N:>12}x")

print("\nThe 'multiplier' is how much more you pay by resending history vs keeping a compact state.")
print("'paid for msg#1' = how many separate times you were billed for your very first message.")

# the curve: per-turn cost rises linearly -> cumulative rises quadratically
print("\nper-turn input cost (notice it climbs every single turn):")
for k in (1, 10, 20, 30, 40):
    per = S + (k-1)*t
    bar = "#" * (per // 400)
    print(f"  turn {k:>3}: {per:>6,} tok  {bar}")
