import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * The about page's shell; the copy itself is the batch 4 footer task
 * (work plan, batch 4). The one sentence is the site's own description.
 */
const AboutComponent = () => (
	<main>
		<div className="px-5 pt-10 md:px-10 md:pt-14">
			<h1 className="text-2xl font-semibold">About</h1>
			<p className="text-muted-foreground mt-4 max-w-prose text-sm">
				Nouveau watches American specialty coffee roasters around the clock and
				tells you when a new lot lands, a sold-out one comes back, or a price
				drops.
			</p>
			<p className="text-muted-foreground mt-4 max-w-prose text-sm">
				See{" "}
				<Link className="underline" to="/activity">
					what people are tasting
				</Link>{" "}
				right now.
			</p>
		</div>
	</main>
);

export const Route = createFileRoute("/about")({
	component: AboutComponent,
});
