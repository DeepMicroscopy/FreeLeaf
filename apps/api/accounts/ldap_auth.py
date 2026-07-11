"""LDAP/AD sign-in (Plan.md §9 Phase 9): the standard "search+bind" pattern
for verifying a password against an LDAP or Active Directory directory —
neither hands out a comparable password hash, so the only way to check a
password is to actually bind as the user. Two binds: first as the
provider's service account to *find* the user's DN (a directory's real DN
naming can be arbitrary, so a fixed template like `uid=%s,ou=...` isn't
reliable in general — a search is), then a second bind as that DN with
the user's own password to verify it.

Verified against ldap3's actual API (imports, `escape_filter_chars`,
`Entry.entry_attributes_as_dict`) directly in this project's dev
container, and against a real disposable OpenLDAP test server
(docker-compose's `openldap` service) end-to-end.
"""

from dataclasses import dataclass

from ldap3 import Connection, Server, SUBTREE
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from core.secret_encryption import decrypt_secret


class LdapAuthError(Exception):
    pass


@dataclass
class LdapIdentity:
    external_id: str  # the user's DN — stable, directory-assigned identifier
    email: str | None
    display_name: str | None


def _first_attr(entry, name: str) -> str | None:
    if not name:
        return None
    values = entry.entry_attributes_as_dict.get(name) or []
    return str(values[0]) if values else None


def authenticate(provider, username: str, password: str) -> LdapIdentity:
    if not username or not password:
        raise LdapAuthError("Username and password are required.")

    server = Server(provider.ldap_server_uri, use_ssl=provider.ldap_server_uri.startswith("ldaps://"))
    bind_password = decrypt_secret(provider.ldap_bind_password_encrypted)

    try:
        service_conn = Connection(server, user=provider.ldap_bind_dn, password=bind_password, auto_bind=True)
    except LDAPException as exc:
        raise LdapAuthError(f"Could not connect to the directory service: {exc}") from exc

    try:
        if provider.ldap_use_starttls:
            service_conn.start_tls()
        search_filter = provider.ldap_user_search_filter % {"user": escape_filter_chars(username)}
        service_conn.search(
            search_base=provider.ldap_user_search_base,
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=[provider.ldap_email_attribute, provider.ldap_display_name_attribute],
        )
        if len(service_conn.entries) == 0:
            raise LdapAuthError("Invalid username or password.")
        entry = service_conn.entries[0]
        user_dn = entry.entry_dn
        email = _first_attr(entry, provider.ldap_email_attribute)
        display_name = _first_attr(entry, provider.ldap_display_name_attribute)
    finally:
        service_conn.unbind()

    try:
        user_conn = Connection(server, user=user_dn, password=password, auto_bind=True)
    except LDAPException as exc:
        raise LdapAuthError("Invalid username or password.") from exc
    user_conn.unbind()

    return LdapIdentity(external_id=user_dn, email=email, display_name=display_name)
