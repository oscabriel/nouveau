import { hairlineInputClass } from "@/lib/ui";

/**
 * The index's search: one hairline under a line of type, no box. The label
 * is the placeholder; screen readers get it as the accessible name. The
 * browser's own clear button is hidden; it belongs to no design system.
 */
export const SearchField = ({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: (next: string) => void;
	value: string;
}) => (
	<input
		aria-label={label}
		autoComplete="off"
		className={`${hairlineInputClass} w-full text-[15px] md:text-base`}
		onChange={(event) => {
			onChange(event.target.value);
		}}
		placeholder={label}
		type="search"
		value={value}
	/>
);
