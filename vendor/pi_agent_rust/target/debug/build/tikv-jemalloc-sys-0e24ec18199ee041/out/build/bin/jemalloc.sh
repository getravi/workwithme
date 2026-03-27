#!/bin/sh

prefix=/Users/ravi/Documents/Dev/workwithme/vendor/pi_agent_rust/target/debug/build/tikv-jemalloc-sys-0e24ec18199ee041/out
exec_prefix=/Users/ravi/Documents/Dev/workwithme/vendor/pi_agent_rust/target/debug/build/tikv-jemalloc-sys-0e24ec18199ee041/out
libdir=${exec_prefix}/lib

DYLD_INSERT_LIBRARIES=${libdir}/libjemalloc.2.dylib
export DYLD_INSERT_LIBRARIES
exec "$@"
