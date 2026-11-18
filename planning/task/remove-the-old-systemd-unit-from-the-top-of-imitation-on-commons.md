# Remove the old systemd unit from the top of ~/imitation on commons

Noted 2026-11-10. `bin/deploy` used to ship the unit as
`~/imitation/imitation.service`; `ts deploy` ships it as
`~/imitation/deploy/imitation.service`, and `bin/ts.rsync` neither ships nor
deletes anything outside its list, so the old copy stays. Nothing reads it.
Once a `ts deploy` has run and `/etc/systemd/system/imitation.service`
matches the new path's copy, delete the old file by hand.
