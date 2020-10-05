
chord = [1, 4, 6 , 12]

def a(n, chord):
    c = chord.copy()
    while 1 and c:
        h = c.pop()
        if h < n:
            break

    print( h)

def b(n, chord):
    for h in reversed(chord):
        if h < n:
            break
    print (h)

for i in (0,1,2,3,4,5,6,7,10):
    a(i,chord)

print()
          
for i in (0,1,2,3,4,5,6,7,10):
    b(i, chord)
    
