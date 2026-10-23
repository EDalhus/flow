// Ordre fra Dynamics 365: SO (salgsordre, henting/utlevering) eller PO (innkjøpsordre, levering inn til kaia).

export type OrderKind = 'SO' | 'PO';

export const SO_PATTERN = /^20\d{5}$/;
/** PO-nummer: bokstaver, tall og bindestrek, f.eks. PO-000123. */
export const PO_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

/** «SO 2043644» eller «PO-000123» (prefikset legges ikke på to ganger). */
export const orderNo = (kind: OrderKind | undefined, n: string) => (kind === 'PO' ? (/^PO/i.test(n) ? n : `PO ${n}`) : `SO ${n}`);
