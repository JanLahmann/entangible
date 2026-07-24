OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

ccx q[0], q[1], q[2];
