// Custom Select Implementation for Taxon Group Dropdown

function initCustomSelect() {
    const selectElement = document.getElementById('taxagroupSelect');
    const customSelect = document.querySelector('.custom-select');
    const trigger = document.querySelector('.custom-select-trigger');
    const optionsContainer = document.querySelector('.custom-options');

    let activeIndex = -1;
    let typeaheadQuery = '';
    let typeaheadTimer = null;

    function customOptions() {
        return Array.from(optionsContainer.querySelectorAll('.custom-option'));
    }

    function setActiveOption(index, { scroll = true } = {}) {
        const options = customOptions();
        if (!options.length) return;

        activeIndex = Math.max(0, Math.min(index, options.length - 1));
        options.forEach((option, optionIndex) => {
            const isActive = optionIndex === activeIndex;
            option.classList.toggle('keyboard-active', isActive);
            if (isActive) optionsContainer.setAttribute('aria-activedescendant', option.id);
        });

        if (scroll) {
            options[activeIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function resetTypeahead() {
        typeaheadQuery = '';
        window.clearTimeout(typeaheadTimer);
        typeaheadTimer = null;
    }

    function openDropdown({ focusOptions = false } = {}) {
        customSelect.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        const selectedIndex = customOptions().findIndex(option => option.dataset.value === selectElement.value);
        setActiveOption(selectedIndex >= 0 ? selectedIndex : 0, { scroll: false });
        if (focusOptions) optionsContainer.focus({ preventScroll: true });
    }

    function closeDropdown({ returnFocus = false } = {}) {
        customSelect.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        resetTypeahead();
        if (returnFocus) trigger.focus({ preventScroll: true });
    }

    function chooseOption(option) {
        if (!option) return;
        selectElement.value = option.dataset.value;
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        syncCustomSelect();
        closeDropdown({ returnFocus: true });
    }

    function findTypeaheadMatch(query, startAfter = -1) {
        const options = customOptions();
        const normalizedQuery = query.toLocaleLowerCase();
        for (let offset = 1; offset <= options.length; offset += 1) {
            const index = (startAfter + offset + options.length) % options.length;
            // "Major Groups" is the overview/placeholder option, not a taxon
            // group. Skipping it lets M go straight to Mammals instead.
            if (options[index].dataset.value
                && options[index].textContent.trim().toLocaleLowerCase().startsWith(normalizedQuery)) {
                return index;
            }
        }
        return -1;
    }

    function handleTypeahead(key) {
        const normalizedKey = key.toLocaleLowerCase();
        const isRepeatedSingleCharacter = typeaheadQuery.length === 1 && typeaheadQuery === normalizedKey;
        const nextQuery = isRepeatedSingleCharacter
            ? normalizedKey
            : `${typeaheadQuery}${normalizedKey}`.slice(0, 3);
        const matchIndex = findTypeaheadMatch(nextQuery, isRepeatedSingleCharacter ? activeIndex : -1);
        if (matchIndex < 0) return false;

        typeaheadQuery = nextQuery;
        window.clearTimeout(typeaheadTimer);
        typeaheadTimer = window.setTimeout(resetTypeahead, 900);
        setActiveOption(matchIndex);
        return true;
    }

    // Toggle dropdown. Moving focus into the list means typing works directly
    // after a mouse click, just like a native country selector.
    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        if (customSelect.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown({ focusOptions: true });
        }
    });

    trigger.addEventListener('keydown', function(event) {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDropdown({ focusOptions: true });
        }
    });

    function handleDropdownKeydown(event) {
        const options = customOptions();
        if (!options.length) return false;

        if (event.key === 'Escape') {
            closeDropdown({ returnFocus: true });
            return true;
        } else if (event.key === 'ArrowDown') {
            setActiveOption((activeIndex + 1 + options.length) % options.length);
            return true;
        } else if (event.key === 'ArrowUp') {
            setActiveOption((activeIndex - 1 + options.length) % options.length);
            return true;
        } else if (event.key === 'Home') {
            setActiveOption(0);
            return true;
        } else if (event.key === 'End') {
            setActiveOption(options.length - 1);
            return true;
        } else if (event.key === 'Enter' || event.key === ' ') {
            chooseOption(options[activeIndex]);
            return true;
        } else if (event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key)) {
            return handleTypeahead(event.key);
        }
        return false;
    }

    // Capture from the document while the menu is open. This keeps type-ahead
    // reliable even when a browser leaves focus on the trigger after a click.
    document.addEventListener('keydown', function(event) {
        if (!customSelect.classList.contains('open')) return;
        if (handleDropdownKeydown(event)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    // Close dropdown when clicking outside
    document.addEventListener('click', function(event) {
        if (!customSelect.contains(event.target)) closeDropdown();
    });

    // Sync custom select with original select
    function syncCustomSelect() {
        const options = Array.from(selectElement.options);
        const selectedValue = selectElement.value;
        
        // Update trigger text
        const selectedOption = options.find(opt => opt.value === selectedValue);
        if (selectedOption) {
            trigger.textContent = selectedOption.textContent;
        } else if (options.length > 0) {
            // Fallback: use first option if selected option not found
            trigger.textContent = options[0].textContent;
        }

        // Update options
        optionsContainer.innerHTML = '';
        options.forEach(option => {
            // Include all options, including those with empty values (like "Major Groups")
            const customOption = document.createElement('div');
            customOption.className = 'custom-option';
            customOption.id = `taxagroupOption-${option.index}`;
            customOption.setAttribute('role', 'option');
            customOption.setAttribute('aria-selected', option.value === selectedValue ? 'true' : 'false');
            if (option.value === selectedValue) {
                customOption.classList.add('selected');
            }
            customOption.textContent = option.textContent;
            customOption.dataset.value = option.value;

            customOption.addEventListener('click', function(e) {
                e.stopPropagation();
                chooseOption(this);
            });

            optionsContainer.appendChild(customOption);
        });

        const selectedIndex = options.findIndex(option => option.value === selectedValue);
        setActiveOption(selectedIndex >= 0 ? selectedIndex : 0, { scroll: false });
    }

    // Watch for changes to the original select (when options are loaded)
    const observer = new MutationObserver(syncCustomSelect);
    observer.observe(selectElement, { childList: true, subtree: true });

    // Also sync when value changes
    selectElement.addEventListener('change', syncCustomSelect);

    // Initial sync
    syncCustomSelect();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomSelect);
} else {
    initCustomSelect();
}
