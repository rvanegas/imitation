# Rotate the wsToken read off the box on 2026-11-10

On 2026-11-10, checking the format of `user_profiles.json` on commons, the
first 300 bytes were printed in a session transcript, and they included user
1's `wsToken`, the token the app signs in with. It is a credential for that
player's account, and it now sits in that transcript.

Issue a new one: sign that player in afresh (sign out and `/link` again,
which sets a new `wsToken`), and confirm the old one is refused. Next time,
read the shape of the file with a tool that prints keys only.
