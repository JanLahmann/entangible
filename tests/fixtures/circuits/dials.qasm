OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

rx(pi/2) q[0];
ry(-pi/2) q[1];
rz(pi) q[2];
