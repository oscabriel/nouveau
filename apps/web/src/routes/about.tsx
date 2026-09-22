import { createFileRoute, Link } from "@tanstack/react-router";

import { Page, PageTitle } from "@/components/page";
import { BRANCH_HEIGHT, BRANCH_SRC, BRANCH_WIDTH } from "@/lib/branch";

/**
 * The about page (ADR-0012): what the product does and how to use every
 * feature, one caps-labeled section per feature, in the tone PRODUCT.md
 * records — plain, honest, specific, no hype. The sources are the hackathon
 * log's "What it does" line and the product context's scope.
 */
const sections = [
	{
		how: [
			'Open "Find my next bag" from any page and write what you\'re after in plain words: "a floral Ethiopian under $30". The agent searches the catalog, checks each lot\'s stock and price, and hands you in-stock picks one card at a time. Turn on "Include my logs" and each pick explains itself against what you\'ve tried.',
		],
		title: "Find my next bag",
	},
	{
		how: [
			'Open any lot and press "Log this lot". Rate it one to five stars, note up to four flavors in your own words, and write what you tasted. Your logs live on your profile page, and every lot page shows what other people thought of it.',
		],
		title: "Logging",
	},
	{
		how: [
			'Press "Watch" on a roaster and Nouveau emails you when a new lot lands, a sold-out one comes back, or the price drops. Press "Check now" on the roaster\'s page when you can\'t wait for the next look. "Mute" a roaster in the alert settings when you want a break. Alerts come from one shared inbox, and replies land back there threaded per roaster, so nothing crosses people.',
		],
		title: "Watching",
	},
	{
		how: [
			'Press "Save" on any lot to keep it on your try list. When you log it, the save clears itself and offers to undo. Your try list is private; nobody else sees it.',
		],
		title: "The try list",
	},
	{
		how: [
			"The Drops table lists every new lot, restock and price drop as it lands, and Activity shows what people are tasting right now. The Roasters directory covers the specialty roasters Nouveau watches around the clock.",
		],
		title: "Drops and activity",
	},
	{
		how: [
			"Buying happens at the roaster. Every \"Buy\" link goes straight to that lot's page on the roaster's shop; Nouveau is an index and a memory, not a store.",
		],
		title: "Buying",
	},
] as const;

/**
 * The plate on the right (owner, 2026-09-21): the landing's branch export,
 * large, filling the column the prose leaves empty, with a caption crediting
 * the plate's author. Hidden below `lg`, where the prose takes the width.
 */
const Plate = () => (
	<figure className="hidden lg:sticky lg:top-14 lg:block lg:self-start">
		<a href="https://en.wikipedia.org/wiki/Coffea_arabica">
			<img
				alt="A branch of Coffea arabica with leaves, white blossoms and red berries, engraved and hand-colored for Robert John Thornton in 1808"
				className="w-full"
				height={BRANCH_HEIGHT}
				loading="lazy"
				src={BRANCH_SRC}
				width={BRANCH_WIDTH}
			/>
		</a>
		<figcaption className="text-muted-foreground mt-4 text-right text-xs">
			<a
				className="hover:text-foreground hover:underline"
				href="https://en.wikipedia.org/wiki/Coffea_arabica"
			>
				<i>Coffea arabica</i>
			</a>
			,{" "}
			<a
				className="hover:text-foreground hover:underline"
				href="https://en.wikipedia.org/wiki/Robert_John_Thornton"
			>
				Robert John Thornton
			</a>
			, 1808
		</figcaption>
	</figure>
);

const AboutComponent = () => (
	<Page>
		<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-16">
			<div>
				<PageTitle
					lede="Nouveau is a live index of specialty coffee and a place to remember what you tried. The catalog updates around the clock from the roasters' own shops. Buying happens at the roaster: Nouveau links out and is not a store."
					title="About"
				/>
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
			<Plate />
		</div>
	</Page>
);

export const Route = createFileRoute("/about")({
	component: AboutComponent,
	head: () => ({ meta: [{ title: "About | Nouveau" }] }),
});
