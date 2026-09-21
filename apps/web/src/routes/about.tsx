import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * The about page (ADR-0012): what the product does and how to use every
 * feature, one caps-labeled section per feature, in the tone PRODUCT.md
 * records — plain, honest, specific, no hype. The sources are the hackathon
 * log's "What it does" line and the product context's scope.
 */
const sections = [
	{
		how: [
			"Open Find my next bag from the home page or your profile and write what you're after, in plain words: \"a floral Ethiopian under $30\". Our agent searches the catalog, checks each lot's stock and price, and hands you up to five picks as cards. Turn on Include my logs and each pick explains itself against what you've tried.",
		],
		title: "Find my next bag",
	},
	{
		how: [
			"Open any lot and press Log this lot. Rate it one to five stars, pick up to four tasting notes, and write what you tasted in your own words. Your logs live on your profile page, and every lot page shows what other people thought of it.",
		],
		title: "Logging",
	},
	{
		how: [
			"Press Watch on a roaster and Nouveau emails you when a new lot lands, a sold-out one comes back, or the price drops. Mute a roaster on the settings page when you want a break. Every watcher gets their own inbox, so replies never cross people.",
		],
		title: "Watching",
	},
	{
		how: [
			"Press Save on any lot to keep it on your try list. When you log it, the save clears itself and offers to undo. Your try list is private; nobody else sees it.",
		],
		title: "The try list",
	},
	{
		how: [
			"The Drops table lists every new lot, restock and price drop as it lands, and Activity shows what people are tasting right now. The Roasters directory covers the American specialty roasters Nouveau watches around the clock.",
		],
		title: "Drops and activity",
	},
	{
		how: [
			"Buying happens at the roaster. Every Buy link goes straight to that lot's page on the roaster's shop; Nouveau is an index and a memory, not a store.",
		],
		title: "Buying",
	},
] as const;

const AboutComponent = () => (
	<main>
		<div className="px-5 pt-10 md:px-10 md:pt-14">
			<h1 className="font-serif text-[2rem] leading-none font-normal md:text-[2.75rem]">
				About
			</h1>
			<p className="text-muted-foreground mt-6 max-w-prose text-sm md:text-[15px]">
				Nouveau is a live index of American specialty coffee and a place to
				remember what you tried. The catalog updates around the clock from the
				roasters&apos; own shops. Buying happens at the roaster: Nouveau links
				out and is not a store.
			</p>
			<div className="mt-12 max-w-prose md:mt-16">
				{sections.map((section) => (
					<section className="mt-10 first:mt-0" key={section.title}>
						<h2 className="label-caps text-foreground">{section.title}</h2>
						{section.how.map((paragraph) => (
							<p
								className="text-muted-foreground mt-3 text-sm md:text-[15px]"
								key={paragraph.slice(0, 24)}
							>
								{paragraph}
							</p>
						))}
					</section>
				))}
			</div>
			<p className="text-muted-foreground mt-12 max-w-prose text-sm md:text-[15px]">
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
