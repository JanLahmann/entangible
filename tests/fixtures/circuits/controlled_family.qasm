OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

cy q[0], q[1];
cz q[0], q[1];
cu1(pi/2) q[0], q[1];
cu1(pi/4) q[0], q[1];
