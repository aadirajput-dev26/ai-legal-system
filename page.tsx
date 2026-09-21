'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    billingApi, loadRazorpay, fmtCredits, fmtINR, FEATURE_LABEL,
    type BillingState, type LedgerEntry, type RazorpayCheckoutResponse,
} from '@/lib/billing';

/**
 * Usage & Billing.
 *
 * Built in the monochrome system: black, white and neutrals only, Arial only,
 * state carried by weight and rules rather than colour. The one exception is
 * --danger, used only when the balance is actually exhausted.
 */

export default function BillingPage() {
    const [state, setState] = useState<BillingState | null>(null);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    // The organisation is explicit everywhere. `orgId` is null only on first
    // load, when the server resolves it for a single-organisation user.
    const [orgId, setOrgId] = useState<string | null>(null);

    const load = useCallback(async (id?: string) => {
        try {
            const s = await billingApi.get(id ?? orgId ?? undefined);
            setOrgId(s.organisation.id);
            const st = await billingApi.statement(s.organisation.id, 25);
            setState(s);
            setEntries(st.entries);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        }
    }, [orgId]);

    useEffect(() => { load(); }, [load]);

    // ── Subscribe ────────────────────────────────────────────────────
    const subscribe = async (planCode: string) => {
        if (!state) return;
        setBusy('subscribe'); setError(null);
        try {
            const s = await billingApi.subscribe(state.organisation.id, planCode);
            const Razorpay = await loadRazorpay();
            new Razorpay({
                key: s.razorpayKeyId,
                subscription_id: s.subscriptionId,
                name: 'LegalDesk',
                description: `${s.planName} — ${fmtCredits(s.includedCredits)} ${state.creditLabel.toLowerCase()} each month`,
                theme: { color: '#0F0F0F' },
                // Checkout success changes nothing here. The server activates the
                // plan when Razorpay's subscription.charged webhook arrives.
                handler: () => {
                    setBusy(null);
                    setError(null);
                    // Checkout success changes nothing server-side; re-read once the
                    // subscription.charged webhook has had a moment to land.
                    setTimeout(() => { void load(); }, 2500);
                },
                modal: { ondismiss: () => setBusy(null) },
            }).open();
        } catch (e: any) {
            setError(e.message); setBusy(null);
        }
    };

    // ── Top up (pay as you go) ───────────────────────────────────────
    const topUp = async (packCode: string) => {
        if (!state) return;
        setBusy(packCode); setError(null);
        try {
            const o = await billingApi.topUp(state.organisation.id, packCode);
            const Razorpay = await loadRazorpay();
            new Razorpay({
                key: o.razorpayKeyId,
                order_id: o.orderId,
                amount: Math.round(o.amountInr * 100),
                currency: 'INR',
                name: 'LegalDesk',
                description: `${o.packName} — ${fmtCredits(o.credits)} ${state.creditLabel.toLowerCase()}`,
                theme: { color: '#0F0F0F' },
                handler: async (r: RazorpayCheckoutResponse) => {
                    try {
                        // Server re-verifies the signature and re-fetches the
                        // payment from Razorpay before granting anything.
                        await billingApi.confirmTopUp(state.organisation.id, r);
                        await load();
                    } catch (e: any) {
                        setError(`Payment went through but we could not confirm it yet: ${e.message}. Your ${state.creditLabel.toLowerCase()} will appear shortly.`);
                    } finally { setBusy(null); }
                },
                modal: { ondismiss: () => setBusy(null) },
            }).open();
        } catch (e: any) {
            setError(e.message); setBusy(null);
        }
    };

    // ── Cancel ───────────────────────────────────────────────────────
    const cancel = async () => {
        if (!state) return;
        if (!window.confirm('Cancel this plan at the end of the current billing period? AI stays available until then.')) return;
        setBusy('cancel'); setError(null);
        try {
            await billingApi.cancel(state.organisation.id);
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally { setBusy(null); }
    };

    if (!state) {
        return (
            <div className="p-8 max-w-5xl">
                <div className="h-3 w-24 bg-black/5 dark:bg-white/5 animate-pulse mb-4 rounded-sm" />
                <div className="h-7 w-48 bg-black/5 dark:bg-white/5 animate-pulse mb-8 rounded-sm" />
                {error && <p className="text-[13px] text-[#C0392B]">{error}</p>}
            </div>
        );
    }

    const b = state.balance;
    const label = state.creditLabel;
    const totalForPeriod = b.allocatedCredits + b.toppedUpCredits;
    const usedPct = totalForPeriod > 0
        ? Math.min(100, Math.round((b.consumedCredits / totalForPeriod) * 100))
        : 0;
    const exhausted = b.balanceCredits < state.minBalanceCredits;
    const isAdmin = state.organisation.role === 'ADMIN';

    return (
        <div className="p-8 pb-24 max-w-5xl" style={{ fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif' }}>

            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-black/45 dark:text-white/40">
                {state.organisation.name}
            </div>
            <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.022em] mt-1.5">Usage &amp; billing</h1>

            <div className="flex items-center gap-2.5 mt-2 text-[12px] text-black/60 dark:text-white/60">
                <span>{b.hasSubscription ? `Plan ${b.subscriptionStatus}` : 'No active plan'}</span>
                {b.periodStart && b.periodEnd && (
                    <>
                        <i className="w-[3px] h-[3px] rounded-full bg-black/25 dark:bg-white/25" />
                        <span className="tabular-nums">
                            {new Date(b.periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(b.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                    </>
                )}
                {!state.enforcementEnabled && (
                    <>
                        <i className="w-[3px] h-[3px] rounded-full bg-black/25 dark:bg-white/25" />
                        <span>Measuring only — nothing is blocked</span>
                    </>
                )}
            </div>

            {error && (
                <div className="mt-6 border border-[#C0392B]/40 bg-[#C0392B]/[0.07] px-3.5 py-3 rounded-sm max-w-[640px]">
                    <p className="text-[12.5px] leading-[19px] text-[#C0392B] m-0">{error}</p>
                </div>
            )}

            {/* ── Balance ─────────────────────────────────────── */}
            <div className="mt-8 pb-8 border-b border-black/[0.14] dark:border-white/[0.12]">
                <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-black/45 dark:text-white/40 mb-3">
                    {label} remaining
                </div>
                <div className="flex items-end gap-4">
                    <span className={`text-[64px] leading-[56px] font-bold tracking-[-0.045em] tabular-nums ${exhausted ? 'text-[#C0392B]' : ''}`}>
                        {fmtCredits(b.balanceCredits)}
                    </span>
                    <span className="pb-1.5 text-[13px] text-black/60 dark:text-white/60 tabular-nums">
                        of {fmtCredits(totalForPeriod)} this period
                    </span>
                </div>

                <div className="mt-5 max-w-[560px]">
                    <div className="h-[3px] w-full bg-black/[0.08] dark:bg-white/[0.08]">
                        <div
                            className={`h-full transition-[width] duration-500 ${exhausted ? 'bg-[#C0392B]' : 'bg-black dark:bg-white'}`}
                            style={{ width: `${usedPct}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-2 text-[11px] text-black/45 dark:text-white/40 tabular-nums">
                        <span>{fmtCredits(b.consumedCredits)} used · {usedPct}%</span>
                        {b.toppedUpCredits > 0 && <span>{fmtCredits(b.toppedUpCredits)} topped up</span>}
                    </div>
                </div>

                {exhausted && (
                    <p className="mt-4 text-[13px] text-[#C0392B] max-w-[56ch]">
                        AI features are paused until you add more {label.toLowerCase()}. Everything else in LegalDesk keeps working.
                    </p>
                )}
            </div>

            {/* ── Plan / top-ups ──────────────────────────────── */}
            {!state.razorpayConfigured ? (
                <p className="mt-8 text-[13px] text-black/60 dark:text-white/60 max-w-[56ch]">
                    Payments are not switched on for this server yet.
                </p>
            ) : !b.hasSubscription ? (
                <section className="mt-8">
                    <h2 className="text-[16px] font-bold tracking-[-0.011em] mb-4">Choose a plan</h2>
                    <div className="max-w-[640px]">
                        {state.plans.map(p => (
                            <div key={p.code} className="flex items-center gap-6 py-4 border-b border-black/[0.08] dark:border-white/[0.07]">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-bold">{p.name}</div>
                                    <div className="text-[12px] text-black/60 dark:text-white/60 mt-1 leading-[18px]">{p.description}</div>
                                </div>
                                <div className="text-right tabular-nums">
                                    <div className="text-[16px] font-bold">{fmtINR(p.priceInr)}</div>
                                    <div className="text-[11px] text-black/45 dark:text-white/40">per month</div>
                                </div>
                                <button
                                    onClick={() => subscribe(p.code)}
                                    disabled={!isAdmin || busy !== null}
                                    className="h-8 px-3.5 rounded-sm text-[13px] font-bold bg-black text-white dark:bg-white dark:text-black disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.985] transition"
                                >
                                    {busy === 'subscribe' ? 'Opening…' : 'Choose'}
                                </button>
                            </div>
                        ))}
                    </div>
                    {!isAdmin && (
                        <p className="mt-3 text-[12px] text-black/45 dark:text-white/40">
                            Only an organisation administrator can change the plan.
                        </p>
                    )}
                </section>
            ) : (
                <section className="mt-8">
                    <h2 className="text-[16px] font-bold tracking-[-0.011em] mb-1">Add more {label.toLowerCase()}</h2>
                    <p className="text-[12px] text-black/60 dark:text-white/60 mb-4 max-w-[56ch]">
                        Top-ups are one-off and never expire while your plan is active.
                    </p>
                    <div className="max-w-[640px]">
                        {state.packs.map(p => (
                            <div key={p.code} className="flex items-center gap-6 py-3.5 border-b border-black/[0.08] dark:border-white/[0.07]">
                                <div className="flex-1 text-[13.5px] font-bold tabular-nums">{p.name}</div>
                                <div className="text-[13px] tabular-nums text-black/60 dark:text-white/60">{fmtINR(p.priceInr)}</div>
                                <button
                                    onClick={() => topUp(p.code)}
                                    disabled={!isAdmin || busy !== null}
                                    className="h-7 px-3 rounded-sm text-[12px] font-bold border border-black/20 dark:border-white/25 hover:bg-black/[0.035] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition"
                                >
                                    {busy === p.code ? 'Opening…' : 'Buy'}
                                </button>
                            </div>
                        ))}
                    </div>

                    {isAdmin && (
                        <div className="mt-6 pt-5 border-t border-black/[0.08] dark:border-white/[0.07] max-w-[640px] flex items-center gap-4">
                            <div className="flex-1">
                                <div className="text-[13px] font-bold">Cancel plan</div>
                                <div className="text-[12px] text-black/60 dark:text-white/60 mt-0.5">
                                    Stops the renewal. AI stays available until {b.periodEnd
                                        ? new Date(b.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
                                        : 'the end of the period'}.
                                </div>
                            </div>
                            <button
                                onClick={cancel}
                                disabled={busy !== null}
                                className="h-7 px-3 rounded-sm text-[12px] font-bold border border-[#C0392B]/40 text-[#C0392B] hover:bg-[#C0392B]/[0.07] disabled:opacity-40 disabled:cursor-not-allowed transition"
                            >
                                {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* ── Where it went ───────────────────────────────── */}
            {state.breakdown.byFeature.length > 0 && (
                <section className="mt-12 grid gap-10 md:grid-cols-[1.4fr_1fr] max-w-[900px]">
                    <div>
                        <h2 className="text-[16px] font-bold tracking-[-0.011em] mb-4">Where it went</h2>
                        {state.breakdown.byFeature.map(f => (
                            <div key={f.feature} className="flex items-center gap-4 py-2.5 border-b border-black/[0.08] dark:border-white/[0.07] text-[13px]">
                                <span className="flex-1">{FEATURE_LABEL[f.feature] || f.feature}</span>
                                <span className="text-black/45 dark:text-white/40 tabular-nums text-[12px]">{f.operations} ops</span>
                                <span className="font-bold tabular-nums w-20 text-right">{fmtCredits(f.credits)}</span>
                            </div>
                        ))}
                    </div>

                    {state.breakdown.byUser.length > 0 && (
                        <div>
                            <h2 className="text-[16px] font-bold tracking-[-0.011em] mb-4">By person</h2>
                            {state.breakdown.byUser.map(u => (
                                <div key={u.userId} className="flex items-center gap-3 py-2.5 border-b border-black/[0.08] dark:border-white/[0.07] text-[13px]">
                                    <span className="flex-1 truncate">{u.name}</span>
                                    <span className="font-bold tabular-nums">{fmtCredits(u.credits)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* ── Statement ───────────────────────────────────── */}
            {entries.length > 0 && (
                <section className="mt-12 max-w-[760px]">
                    <h2 className="text-[16px] font-bold tracking-[-0.011em] mb-4">Statement</h2>
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="text-[11px] font-bold tracking-[0.06em] uppercase text-black/45 dark:text-white/40 border-b border-black/[0.14] dark:border-white/[0.12]">
                                <th className="text-left h-8 font-bold">Entry</th>
                                <th className="text-left font-bold">When</th>
                                <th className="text-right font-bold">{label}</th>
                                <th className="text-right font-bold pr-1">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((e, i) => (
                                <tr key={i} className="border-b border-black/[0.08] dark:border-white/[0.07] text-[13px]">
                                    <td className="h-10">
                                        <span className="font-bold">{e.feature ? (FEATURE_LABEL[e.feature] || e.feature) : e.reason || e.type}</span>
                                        {e.tokens != null && (
                                            <span className="text-[11px] text-black/45 dark:text-white/40 ml-2 tabular-nums">
                                                {e.tokens.toLocaleString('en-IN')} tokens{e.model ? ` · ${e.model}` : ''}
                                            </span>
                                        )}
                                    </td>
                                    <td className="text-black/60 dark:text-white/60 text-[12px] tabular-nums">
                                        {new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="text-right tabular-nums font-bold">
                                        {e.credits > 0 ? '+' : ''}{e.credits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="text-right tabular-nums text-black/60 dark:text-white/60 pr-1">
                                        {fmtCredits(e.balanceAfter)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}
