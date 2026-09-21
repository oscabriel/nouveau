// Crawl scheduler: the tick picks up due sources (crons.interval only, per
// the Convex guidelines), the stale sweep derives watch status.

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 5 minutes: claim due crawl sources and hand them to the crawler.
// The 15-minute detection bar never needs a faster loop than this.
crons.interval(
	"crawl due sources",
	{ minutes: 5 },
	internal.crawlSources.tick,
	{}
);

// Hourly: flip watching sources that have gone quiet past their staleness
// threshold (2x cadence, minimum 1 hour) to stale.
crons.interval(
	"sweep stale sources",
	{ minutes: 60 },
	internal.crawlSources.sweepStale,
	{}
);

// Daily: prune raw capture bodies past the retention window (blob + row).
crons.interval(
	"prune raw captures",
	{ hours: 24 },
	internal.crawlSources.pruneRawCaptures,
	{}
);

// Daily: drop pipeline traces past three days and workbench runs past
// seven (ADR-0018). The tail is a window onto recent reads, not a log.
crons.interval(
	"prune pipeline traces",
	{ hours: 24 },
	internal.nerdStuff.prune,
	{}
);

export default crons;
