import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * The about page (ADR-0012): what the product does, in the tone PRODUCT.md
 * records — plain, honest, specific, no hype. The sources are the hackathon
 * log's "What it does" line and the product context's scope.
 */
const AboutComponent = () => (
	<main>
		<div className="px-5 pt-10 md:px-10 md:pt-14">
			<h1 className="text-[1.75rem] leading-none font-semibold md:text-[2.25rem]">
				About
			</h1>
			<p className="text-muted-foreground mt-6 max-w-prose text-sm md:text-[15px]">
				Nouveau is a coffee memory for home brewers. Log the lots you try. Ask
				Find my next bag for a shortlist of in-stock coffees, each compared to
				your logs in the roaster&apos;s own words. Save what you want to try.
				Watch roasters and get an email when a new lot lands, a sold-out one
				comes back, or a price drops.
			</p>
			<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
				The catalog comes from watching American specialty roasters&apos; shops
				around the clock. Buying happens at the roaster: Nouveau links out and
				is not a store.
			</p>
			<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
				See{" "}
				<Link className="text-foreground underline" to="/activity">
					what people are tasting
				</Link>{" "}
				right now, or{" "}
				<Link className="text-foreground underline" to="/roasters">
					browse the roasters
				</Link>{" "}
				we watch.
			</p>
		</div>
	</main>
);

export const Route = createFileRoute("/about")({
	component: AboutComponent,
});
