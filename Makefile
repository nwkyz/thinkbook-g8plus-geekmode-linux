# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 nwkyz

obj-m += ideapad-laptop.o

KDIR ?= /lib/modules/$(shell uname -r)/build

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
