import { Link } from "wouter";
import s from "./ListingsPage.module.css";

export function NotFound() {
	return (
		<div className={s.page}>
			<main className={s.intro}>
				<h1>No page here</h1>
				<p>
					This address isn’t a Foreman page.{" "}
					<Link href="/">See today’s listings</Link>.
				</p>
			</main>
		</div>
	);
}
