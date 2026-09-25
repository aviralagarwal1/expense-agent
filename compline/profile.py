def split_name_parts(full_name: str):
    parts = [part for part in (full_name or "").strip().split() if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def get_profile_seed_from_user(user):
    metadata = getattr(user, "user_metadata", {}) or {}

    first_name = (
        metadata.get("first_name")
        or metadata.get("firstName")
        or metadata.get("given_name")
        or ""
    ).strip()
    last_name = (
        metadata.get("last_name")
        or metadata.get("lastName")
        or metadata.get("family_name")
        or ""
    ).strip()

    if not first_name:
        seed_full_name = (
            metadata.get("full_name")
            or metadata.get("display_name")
            or metadata.get("name")
            or ""
        ).strip()
        seed_first, seed_last = split_name_parts(seed_full_name)
        first_name = first_name or seed_first
        last_name = last_name or seed_last

    return {
        "first_name": first_name or None,
        "last_name": last_name or None,
    }
