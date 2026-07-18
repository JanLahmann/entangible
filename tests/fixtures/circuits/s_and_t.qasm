OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

h q[0];
rz(pi/2) q[0];
rz(pi/4) q[0];
