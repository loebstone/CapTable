import { useState } from "react";
import { useRequestSignIn } from "@workspace/api-client-react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Btn, inputCls } from "@/components/bits";
import { errMessage } from "@/lib/format";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const req = useRequestSignIn();
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <div className="grid min-h-[100dvh] md:grid-cols-[1.1fr_1fr]">
      <section className="rings relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground md:flex">
        <div className="text-[11px] uppercase tracking-[0.2em] text-sidebar-primary">Private family record</div>
        <div className="rise">
          <h1 className="font-display text-5xl leading-[1.05] text-[hsl(40_40%_97%)]">HWD Farm<br />distributions ledger</h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed opacity-75">
            Shareholdings, tax residence and annual rates for the timber income, kept carefully and written down once.
            Every change is recorded with a note.
          </p>
        </div>
        <svg viewBox="0 0 400 60" className="w-full max-w-md text-sidebar-primary/50" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => (
            <path key={i} d={`M${10 + i * 16} 60 L${18 + i * 16} ${20 + ((i * 37) % 22)} L${26 + i * 16} 60Z`} fill="currentColor" opacity={0.35 + ((i * 13) % 6) / 10} />
          ))}
        </svg>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="rise w-full max-w-sm">
          <div className="font-display text-2xl md:hidden">HWD Farm</div>
          <h2 className="font-display mt-1 text-3xl">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the email address the family has on file. We will send a one-time sign-in link; there is no password.
          </p>

          {req.isSuccess ? (
            <div className="rise mt-8 rounded-lg border border-border bg-card p-5" data-testid="status-link-sent">
              <MailCheck className="h-5 w-5 text-primary" />
              <div className="mt-3 text-sm font-medium">{req.data.message}</div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Open the link from the same browser. If this server has no mail delivery configured (development only), the
                link is written to the server log instead of being emailed; ask whoever runs the server to read it from there.
              </p>
              <button className="mt-4 text-xs text-primary underline-offset-4 hover:underline" onClick={() => req.reset()} data-testid="button-use-different-email">
                Use a different address
              </button>
            </div>
          ) : (
            <form
              className="mt-8 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) req.mutate({ data: { email: email.trim() } });
              }}
            >
              <input
                type="email"
                aria-label="Email address"
                autoFocus
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls + " py-2.5"}
                data-testid="input-email"
              />
              {req.isError && <div className="text-xs text-destructive" data-testid="status-signin-error">{errMessage(req.error)}</div>}
              <Btn type="submit" className="w-full py-2.5" disabled={!valid || req.isPending} data-testid="button-request-link">
                {req.isPending ? "Sending…" : "Send sign-in link"} <ArrowRight className="h-4 w-4" />
              </Btn>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
