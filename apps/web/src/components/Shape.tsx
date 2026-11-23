// Grey shapes standing where content will be while it loads (docs/decisions/2026-11-23-read-back.md,
// decision 3). Shapes carry no words; each loading screen names what it's reading once, for screen readers.

import type { CSSProperties, ReactNode } from "react";
import s from "./Shape.module.css";

export function Shape({
	w = "100%",
	h,
	r,
	mt,
	style,
}: {
	w?: CSSProperties["width"];
	h: number;
	r?: number;
	mt?: number;
	style?: CSSProperties;
}) {
	return (
		<span
			className={s.shape}
			aria-hidden="true"
			style={{ width: w, height: h, borderRadius: r, marginTop: mt, ...style }}
		/>
	);
}

/** One plain sentence of what a loading screen is reading, for screen readers; the shapes say nothing. */
export function LoadingNote({ children }: { children: ReactNode }) {
	return (
		<p className={s.hidden} role="status">
			{children}
		</p>
	);
}

/** Shapes for a list of rows, each a badge, two lines and a figure on the right. */
export function RowShapes({ count }: { count: number }) {
	const widths = ["62%", "48%", "70%", "55%", "66%", "44%", "58%", "50%"];
	return (
		<ul className={s.rows} aria-hidden="true">
			{widths.slice(0, count).map((w) => (
				<li key={w}>
					<Shape w={40} h={40} r={999} />
					<span>
						<Shape w={w} h={16} />
						<Shape w="35%" h={12} mt={8} />
					</span>
					<span className={s.end}>
						<Shape w={88} h={16} />
						<Shape w={56} h={12} mt={8} />
					</span>
				</li>
			))}
		</ul>
	);
}
