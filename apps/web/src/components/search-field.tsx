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
		className="placeholder:text-muted-foreground focus-visible:border-foreground h-11 w-full border-b bg-transparent text-[15px] outline-none focus-visible:outline-none md:text-base [&::-webkit-search-cancel-button]:hidden"
		onChange={(event) => {
			onChange(event.target.value);
		}}
		placeholder={label}
		type="search"
		value={value}
	/>
);
